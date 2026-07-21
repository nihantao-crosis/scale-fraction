'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const swSource = fs.readFileSync(path.resolve(__dirname, '..', 'sw.js'), 'utf8');

class FakeResponse {
  constructor(body, options = {}) {
    this.body = body;
    this.ok = options.ok !== false;
    this.status = options.status || (this.ok ? 200 : 500);
    this.type = options.type || 'basic';
  }
  clone() {
    return new FakeResponse(this.body, { ok: this.ok, status: this.status, type: this.type });
  }
}

function createWorker() {
  const scope = 'https://example.test/app/';
  const listeners = {};
  const stores = new Map();
  let network = async () => new FakeResponse('network');
  let failPut = false;
  let hangPut = false;
  let failOpen = false;

  function requestKey(input) {
    if (typeof input === 'string') return new URL(input, scope).href;
    return input.url;
  }

  class FakeCache {
    constructor(name) {
      this.name = name;
      if (!stores.has(name)) stores.set(name, new Map());
      this.entries = stores.get(name);
    }
    async addAll(assets) {
      for (const asset of assets) this.entries.set(requestKey(asset), new FakeResponse('precache:' + asset));
    }
    async match(request) {
      const value = this.entries.get(requestKey(request));
      return value ? value.clone() : undefined;
    }
    async put(request, response) {
      if (failPut) throw new Error('put failed');
      if (hangPut) return new Promise(() => {});
      this.entries.set(requestKey(request), response.clone());
    }
  }

  const caches = {
    async open(name) {
      if (failOpen) throw new Error('cache unavailable');
      return new FakeCache(name);
    },
    async keys() { return Array.from(stores.keys()); },
    async delete(name) { return stores.delete(name); }
  };
  const self = {
    location: { origin: 'https://example.test' },
    registration: { scope },
    clients: { async claim() {} },
    async skipWaiting() {},
    addEventListener(type, handler) { listeners[type] = handler; }
  };
  const context = vm.createContext({
    self,
    caches,
    URL,
    Promise,
    fetch(request) { return network(request); }
  });
  vm.runInContext(swSource, context, { filename: 'sw.js' });

  async function lifecycle(type) {
    const waits = [];
    listeners[type]({ waitUntil(promise) { waits.push(Promise.resolve(promise)); } });
    await Promise.all(waits);
  }

  function dispatchFetch(request) {
    const waits = [];
    let responsePromise;
    listeners.fetch({
      request,
      respondWith(promise) { responsePromise = Promise.resolve(promise); },
      waitUntil(promise) { waits.push(Promise.resolve(promise)); }
    });
    return {
      response: responsePromise || Promise.resolve(undefined),
      complete: Promise.all(waits)
    };
  }

  async function fetchEvent(request) {
    const dispatched = dispatchFetch(request);
    const response = await dispatched.response;
    await dispatched.complete;
    return response;
  }

  return {
    context,
    stores,
    caches,
    lifecycle,
    fetchEvent,
    dispatchFetch,
    setNetwork(fn) { network = fn; },
    setFailPut(value) { failPut = value; },
    setHangPut(value) { hangPut = value; },
    setFailOpen(value) { failOpen = value; },
    request(url, options = {}) {
      return { url, method: options.method || 'GET', mode: options.mode || 'same-origin' };
    }
  };
}

test('service worker precaches the complete app shell and isolates activation cleanup', async () => {
  const worker = createWorker();
  await worker.lifecycle('install');
  const cacheName = worker.context.CACHE;
  const appCache = worker.stores.get(cacheName);
  assert.ok(appCache.has('https://example.test/app/index.html'));
  assert.ok(appCache.has('https://example.test/app/core.js'));
  assert.ok(appCache.has('https://example.test/app/manifest.webmanifest'));

  worker.stores.set('sf-calc-v6', new Map());
  worker.stores.set('another-app-cache', new Map());
  await worker.lifecycle('activate');
  assert.equal(worker.stores.has('sf-calc-v6'), false);
  assert.equal(worker.stores.has('another-app-cache'), true);
  assert.equal(worker.stores.has(cacheName), true);
});

test('online app requests are network-first and refresh an old cache', async () => {
  const worker = createWorker();
  await worker.lifecycle('install');
  const request = worker.request('https://example.test/app/core.js');
  const cache = await worker.caches.open(worker.context.CACHE);
  await cache.put(request, new FakeResponse('old-core'));
  worker.setNetwork(async () => new FakeResponse('new-core'));

  const response = await worker.fetchEvent(request);
  assert.equal(response.body, 'new-core');
  assert.equal((await cache.match(request)).body, 'new-core');
});

test('offline requests use the exact cached asset or navigation fallback', async () => {
  const worker = createWorker();
  await worker.lifecycle('install');
  worker.setNetwork(async () => { throw new Error('offline'); });

  const core = await worker.fetchEvent(worker.request('https://example.test/app/core.js'));
  assert.equal(core.body, 'precache:./core.js');

  const navigation = await worker.fetchEvent(worker.request('https://example.test/app/deep/link', { mode: 'navigate' }));
  assert.equal(navigation.body, 'precache:./index.html');
});

test('successful navigation refreshes the canonical offline fallback', async () => {
  const worker = createWorker();
  await worker.lifecycle('install');
  worker.setNetwork(async () => new FakeResponse('new-index'));

  const online = await worker.fetchEvent(worker.request('https://example.test/app/', { mode: 'navigate' }));
  assert.equal(online.body, 'new-index');

  worker.setNetwork(async () => { throw new Error('offline'); });
  const deepLink = await worker.fetchEvent(worker.request('https://example.test/app/deep/link', { mode: 'navigate' }));
  assert.equal(deepLink.body, 'new-index');
});

test('cache failures and slow writes never block a healthy network response', async () => {
  const worker = createWorker();
  worker.setNetwork(async () => new FakeResponse('network-without-cache'));
  worker.setFailOpen(true);
  assert.equal((await worker.fetchEvent(worker.request('https://example.test/app/core.js'))).body, 'network-without-cache');

  worker.setFailOpen(false);
  worker.setHangPut(true);
  const dispatched = worker.dispatchFetch(worker.request('https://example.test/app/core.js'));
  const outcome = await Promise.race([
    dispatched.response.then((response) => response.body),
    new Promise((resolve) => setTimeout(() => resolve('blocked-on-cache-put'), 30))
  ]);
  assert.equal(outcome, 'network-without-cache');
});

test('fetch handling ignores unsafe scope and never caches bad responses', async () => {
  const worker = createWorker();
  assert.equal(await worker.fetchEvent(worker.request('https://other.test/app/core.js')), undefined);
  assert.equal(await worker.fetchEvent(worker.request('https://example.test/outside/core.js')), undefined);
  assert.equal(await worker.fetchEvent(worker.request('https://example.test/app/core.js', { method: 'POST' })), undefined);

  await worker.lifecycle('install');
  const request = worker.request('https://example.test/app/missing.js');
  worker.setNetwork(async () => new FakeResponse('missing', { ok: false, status: 404 }));
  const response = await worker.fetchEvent(request);
  assert.equal(response.status, 404);
  const cache = await worker.caches.open(worker.context.CACHE);
  assert.equal(await cache.match(request), undefined);

  const opaqueRequest = worker.request('https://example.test/app/font.woff2');
  worker.setNetwork(async () => new FakeResponse('opaque', { type: 'opaque' }));
  assert.equal((await worker.fetchEvent(opaqueRequest)).body, 'opaque');
  assert.equal(await cache.match(opaqueRequest), undefined);

  worker.setFailPut(true);
  worker.setNetwork(async () => new FakeResponse('fresh'));
  assert.equal((await worker.fetchEvent(worker.request('https://example.test/app/index.html'))).body, 'fresh');
});
