// Which issues belong to an owner. Mirrors public.owner_tokens / owner aliases in migration 0014.
// A tracker Owner cell can name several people ("Anjali Iyer / Amit Jadhav") and the same person
// is often written differently across trackers ("Abhijit", "Mendki Abhijit", "Abhijeet Mendki").
// So an issue belongs to an owner when ANY name in its Owner cell matches ANY of their aliases.

function normName(value) {
  const n = String(value ?? '').toLowerCase().replace(/[\s.]+/g, ' ').trim();
  return n || null;
}

function ownerTokens(owner) {
  return [...new Set(String(owner ?? '').split(/\s*[/,&;+]\s*/).map(normName).filter(Boolean))];
}

// Same default aliases the database gives a new owner: full name, reversed name, first name.
function aliasesForName(name) {
  const n = normName(name);
  if (!n) return [];
  const words = n.split(' ');
  const out = [n];
  if (words.length > 1) {
    out.push(`${words[words.length - 1]} ${words[0]}`);
    if (words.length > 2) out.push(`${words[0]} ${words[words.length - 1]}`);
  }
  out.push(words[0]);
  return [...new Set(out)];
}

function ownsTask(taskOwner, aliases) {
  if (!aliases || !aliases.length) return false;
  const set = new Set(aliases.map(normName).filter(Boolean));
  return ownerTokens(taskOwner).some((t) => set.has(t));
}

// True when this signed-in person is the owner of the issue (or one of its owners).
function isOwnerOf(session, task) {
  if (!session || session.role !== 'Owner' || !task) return false;
  const aliases = session.aliases && session.aliases.length ? session.aliases : aliasesForName(session.name);
  return ownsTask(task.owner, aliases);
}

module.exports = { normName, ownerTokens, aliasesForName, ownsTask, isOwnerOf };
