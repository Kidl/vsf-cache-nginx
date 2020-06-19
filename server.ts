import { serverHooks } from '@vue-storefront/core/server/hooks'
import fetch from 'isomorphic-fetch'
import config from 'config'
import cache from '@vue-storefront/core/scripts/utils/cache-instance'

let urlsToClear = []

// It sends request then waits provided amount of miliseconds
const requestAndWait = (promise: Promise<any>, time: number): Promise<any> => {
  return new Promise((resolve, reject) => {
    promise.then(() => {
      console.log(`Waiting ${time/1000} second${time > 1999 ? 's' : ''}`)
      setTimeout(resolve, time)
    }).catch(reject)
  })
}

// There I will create (Tag -> URL) Map in Redis Cache
// So then I will be able to refresh certain URL based on requested Tags
serverHooks.beforeOutputRenderedResponse(({ output, req, context }) => {
  if (!config.get('nginx.enabled')) {
    return output
  }

  const tagsArray = Array.from(context.output.cacheTags)
  const site = req.headers['x-vs-store-code'] || 'main'

  const promises = []

  for (let tag of tagsArray) {
    const tagUrlMap = `nginx:${site}:${tag}`
    promises.push(
      cache.get(tagUrlMap)
      .then(output => {
        const reqUrl = `${config.get('nginx.protocol')}://${config.get('nginx.host')}:${config.get('nginx.port')}${req.url}`
        
        cache.set(
          tagUrlMap,
          output === null ? [reqUrl] : Array.from(new Set([...output, reqUrl])),
          tagsArray
        ).catch(err => {
          console.log(`Could not save '${tag}' tag's URL`, err)
        })
      }).catch(err => {
        console.log(`Could not read '${tag}' tag's URL`, err)
      })
    )
  }

  Promise.all(promises).then(() => {
    console.log('Succesfully saved tag\'s URL', tagsArray)
  }).catch(err => {
    console.log('Failed while saving tag\'s URL', err)
  })

  return output
})

// There I prepare array of invalidate request to send
// I am storing them in global array called `urlsToClear`
serverHooks.beforeCacheInvalidated(({ tags, req }) => {
  // Here saved tags exist
  if (!config.get('nginx.enabled') || !config.get('server.useOutputCache') || !config.get('server.useOutputCacheTagging')) {
    return
  }
  console.log('Storing PWA\'s Nginx Urls')
  const site = req.headers['x-vs-store-code'] || 'main'

  for (let tag of tags) {
    if (config.server.availableCacheTags.indexOf(tag) >= 0 || config.server.availableCacheTags.find(t => {
      return tag.indexOf(t) === 0
    })) {

      const tagUrlMap = `nginx:${site}:${tag}`
      cache.get(tagUrlMap)
        .then(output => {
          
          if (output === null) {
            return
          }
          // output should be an array
          for (let url of output) {
            urlsToClear.push(
              requestAndWait(fetch(url, {
                headers: {
                  'Bypass-Key': config.get('nginx.bypassKey')
                }
              }).catch(err => {
                console.error(`Couldn't ban tag: ${tag} in the Nginx`, err);
              }), config.get('nginx.bypassTimeOffset'))
            )
          }

        }).catch(err => {
          console.log(`Could not read '${tag}' tag's URL`, err)
        })

    } else {
      console.error(`Invalid tag name ${tag}`)
    }
  }
})

// There I will send earlier prepared promises from `urlsToClear` array
// Why now?
// Redis' just invalidated data. So only here I can access fresh one
// I am sending request to nginx with `proxy_cache_bypass` equal 1 
// So it will skip cache and reach Redis with fresh data

serverHooks.afterCacheInvalidated(() => {
  // Why am I not preparing promises here?
  // Here tags might not exist in Redis...
  if (!config.get('nginx.enabled') || !config.get('server.useOutputCache') || !config.get('server.useOutputCacheTagging')) {
    return
  }
  if (urlsToClear && urlsToClear.length) {
    console.log('Invalidating Stored Nginx Urls')
    Promise.all(urlsToClear).then(() => {
      console.log('Purged tags in NGINX')
    }).catch(err => {
      console.log('Could not purge tags in NGINX')
    }).finally(() => {
      console.log('Clearing saved NGINX Urls')
      urlsToClear = []
    })
  }
})
