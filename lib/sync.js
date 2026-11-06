// Quick reload: compare the issues kept in this browser with the server's list of issue ids and
// their last-change time (updated_at), and download only what is new or changed. Rows are database
// rows (as selected in lib/store/supabase.js), each with id and updated_at.

// stamps: [{ id, updated_at }] for every issue the person can see now.
function planSync(cachedRows, stamps) {
  const cached = new Map((cachedRows || []).map((r) => [r.id, r]));
  const keep = [];
  const fetchIds = [];
  stamps.forEach((s) => {
    const row = cached.get(s.id);
    if (row && row.updated_at === s.updated_at) keep.push(row);
    else fetchIds.push(s.id);
  });
  const removed = cached.size - keep.length - fetchIds.filter((id) => cached.has(id)).length;
  return { keep, fetchIds, removed };
}

// Changed rows replace kept ones; a row that vanished between the two requests is simply left out.
function applySync(keep, fetched) {
  const byId = new Map(keep.map((r) => [r.id, r]));
  fetched.forEach((r) => byId.set(r.id, r));
  return [...byId.values()];
}

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

module.exports = { planSync, applySync, chunk };
