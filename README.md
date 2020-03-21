# VSF Cache NGINX

**It does not require NGINX Plus**

By default VSF is able to cache SSR Output in the Redis Cache. This module will Cache Redis Output in the NGINX. So Node.js server is not being used even to load output from Redis. It makes our app's first load even faster!

Example Category's view response time: 1920ms   
Example Category's view response time with NGINX: 16ms

I've given same response time for both Varnish and Nginx as they are really similar.
In my example config - default.conf, I also added basic gzip compression.
Response times are *without HTML minifier* - in development mode. So in production it should be even faster.

## How to install
To config's main section add:
```json
"nginx": {
  "enabled": true,
  "bypass_key": "ad3489sf545824893289dfsdfsd",
  "host": "localhost",
  "port": 80,
  "protocol": "http",
  "bypassTimeOffset": 500
}
```

Obviously, set proper `host` and `port` if you are on production.
You should also enable those 2 values in `server` section:
```json
"useOutputCacheTagging": true,
"useOutputCache": true
```

Purge request will be send by Node server to Nginx. So if you are using k8s and one machine you probably want to send it via HTTP (without unnecessary TSL).

`bypass_key` - is value that tells Nginx that request is allowed to refresh cache. You should set it to equal this value in Nginx's config:
```
set $secret_key "ad3489sf545824893289dfsdfsd";
```
`bypassTimeOffset` - time in miliseconds that app will wait after each Bypass request, by default it is 500ms. But you should find the best one for yourself.

## Why do we wait between purge requests?
For real, free version of Nginx allows us only to use `proxy_cache_bypass`. If we set this to `1` - the request will go to the origin and update our cache. So what we do?:
1. Purge Cache in Redis
2. Send request to our App with `proxy_cache_bypass == 1`
3. Now our request will reach our PWA Node server. So if we would not wait between requests. For a few thousands of URLs to refresh, we could just DDoS our server... To prevent that, after each direct request to Node server, it will wait `bypassTimeOffset` amount of time.

Well... as we use Promise.all. We are resolving 2 promises in paralell and after each of them we waits `bypassTimeOffset` amount of time - then we send next one...

## How to test it locally
1. Run app with `docker-compose up`
2. Run Varnish with `docker-compose -f src/modules/vsf-cache-varnish/docker-compose.varnish.yml up`
3. On port :80, you should have Cached with Varnish App. On port :3000 you should have Cached with Redis App.

## How to install Varnish on VPS?
I've just used:
```
sudo apt-get install varnish
```

## How to configure Varnish on production?
https://devdocs.magento.com/guides/v2.3/config-guide/varnish/config-varnish-configure.html

## How to purge cache?
When we purge Redis' cache. It will also purge Varnish's cache. So just open:
```
http://localhost:3000/invalidate?key=aeSu7aip&tag=*
```

## Do I need varnish-modules?
As we do not cache POST requests (like here: https://github.com/DivanteLtd/vue-storefront-api/tree/develop/docker/varnish). It is **not** needed.

## Caching does not work
Make sure you have this bugfix in your PWA: https://github.com/DivanteLtd/vue-storefront/pull/4143

## Invalidate * does not work for category/product
Make sure it is fixed: https://github.com/DivanteLtd/vue-storefront/issues/4173