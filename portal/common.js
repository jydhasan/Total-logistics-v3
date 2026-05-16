/* global fetch */
(function () {
  const API_BASE = '';

  function getToken() {
    return localStorage.getItem('tll_token');
  }

  function setToken(t) {
    if (t) localStorage.setItem('tll_token', t);
    else localStorage.removeItem('tll_token');
  }

  function redirectForRole(role) {
    if (role === 'client') window.location.href = '/portal/client.html';
    else if (role === 'manager') window.location.href = '/portal/manager.html';
    else if (role === 'superadmin') window.location.href = '/portal/super-admin.html';
    else if (role === 'webadmin') window.location.href = '/portal/web-admin.html';
    else window.location.href = '/portal/login.html';
  }

  async function api(path, options) {
    const opts = options || {};
    const headers = Object.assign({}, opts.headers || {});
    let body = opts.body;
    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const tok = getToken();
    if (tok) headers.Authorization = 'Bearer ' + tok;
    const res = await fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers,
      body: body !== undefined ? body : undefined,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text || 'Invalid response' };
    }
    if (!res.ok) {
      const err = new Error(data.error || res.statusText || 'Request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  window.TLL = { getToken, setToken, redirectForRole, api };
})();
