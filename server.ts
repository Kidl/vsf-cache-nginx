import { serverHooks } from '@vue-storefront/core/server/hooks'
import fetch from 'isomorphic-fetch'
import config from 'config'
import cache from '@vue-storefront/core/scripts/utils/cache-instance'

let urlsToClear = []

serverHooks.beforeOutputRenderedResponse(({ output, req, context }) => {
  if (!config.get('nginx.enabled')) {
    return
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
        console.log(tagUrlMap, output === null, reqUrl)
        
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
          console.log('Reading', tagUrlMap, output === null)
          
          if (output === null) {
            return
          }
          // output should be an array
          for (let url of output) {
            urlsToClear.push(
              fetch(url, {
                headers: {
                  'Bypass-Key': config.get('nginx.bypass_key')
                }
              }).catch(err => {
                console.error(`Couldn't ban tag: ${tag} in the Nginx`, err);
              })
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

serverHooks.afterCacheInvalidated(({ tags, req }) => {
  // Here saved tags do not exist
  if (!config.get('nginx.enabled') || !config.get('server.useOutputCache') || !config.get('server.useOutputCacheTagging')) {
    return
  }
  console.log('Invalidating Stored Nginx Urls')
  if (urlsToClear && urlsToClear.length) {
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
