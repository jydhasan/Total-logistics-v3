/* Visitor analytics — page view + batched click counts (same origin). */
(function () {
  function postVisit() {
    fetch('/api/track/visit', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: location.pathname + location.search }),
    }).catch(function () {});
  }
  postVisit();

  var clickN = 0;
  var timer;
  document.addEventListener(
    'click',
    function () {
      clickN++;
      clearTimeout(timer);
      timer = setTimeout(function () {
        var n = clickN;
        clickN = 0;
        if (n < 1) return;
        fetch('/api/track/click', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: location.pathname + location.search, count: n }),
        }).catch(function () {});
      }, 2500);
    },
    true
  );
})();
