/**
 * Bucket visits into day / week / month for charts.
 * kind: 'pageview' (default) | 'click'
 */
function startOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function mondayOfWeekContaining(d) {
  const x = startOfLocalDay(d);
  const dow = x.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + offset);
  return x;
}

function inRange(t, start, end) {
  return t >= start && t <= end;
}

function aggregateVisits(visits, period) {
  const list = Array.isArray(visits) ? visits : [];
  const now = new Date();
  const labels = [];
  const ranges = [];

  if (period === 'day') {
    const sod = startOfLocalDay(now);
    for (let i = 29; i >= 0; i--) {
      const day = new Date(sod);
      day.setDate(sod.getDate() - i);
      const start = day.getTime();
      const end = start + 86400000 - 1;
      labels.push(
        day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      );
      ranges.push({ start, end });
    }
  } else if (period === 'week') {
    const thisMonday = mondayOfWeekContaining(now);
    for (let i = 0; i < 12; i++) {
      const ws = new Date(thisMonday);
      ws.setDate(thisMonday.getDate() - (11 - i) * 7);
      const start = ws.getTime();
      const end = start + 7 * 86400000 - 1;
      labels.push(`Week ${ws.getDate()}/${ws.getMonth() + 1}`);
      ranges.push({ start, end });
    }
  } else {
    for (let i = 0; i < 12; i++) {
      const dt = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
      const start = dt.getTime();
      const end = new Date(dt.getFullYear(), dt.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
      labels.push(dt.toLocaleString('en', { month: 'short', year: 'numeric' }));
      ranges.push({ start, end });
    }
  }

  const pageviews = ranges.map(({ start, end }) =>
    list.filter((v) => {
      const t = new Date(v.createdAt).getTime();
      if (!inRange(t, start, end)) return false;
      return !v.kind || v.kind === 'pageview';
    }).length
  );

  const clicks = ranges.map(({ start, end }) =>
    list.reduce((sum, v) => {
      const t = new Date(v.createdAt).getTime();
      if (!inRange(t, start, end)) return sum;
      if (v.kind !== 'click') return sum;
      const c = typeof v.clickCount === 'number' && v.clickCount > 0 ? v.clickCount : 1;
      return sum + c;
    }, 0)
  );

  return {
    period,
    labels,
    pageviews,
    clicks,
    totals: {
      pageviews: pageviews.reduce((a, b) => a + b, 0),
      clicks: clicks.reduce((a, b) => a + b, 0),
    },
  };
}

module.exports = { aggregateVisits };
