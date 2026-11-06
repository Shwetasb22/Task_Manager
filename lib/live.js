// Applies one live database change to the issues already in memory, so a teammate's edit updates
// this screen without downloading every issue again. Changes come from store.subscribe():
//   { type: 'upsert', task }            issue added or edited (task has no proofs list)
//   { type: 'delete', id }              issue deleted
//   { type: 'proof-added', taskId, proof }
//   { type: 'proof-removed', proofId }
function applyLiveChange(tasks, change) {
  if (!change) return tasks;
  if (change.type === 'upsert' && change.task && change.task.id) {
    const index = tasks.findIndex((t) => t.id === change.task.id);
    if (index < 0) return [{ ...change.task, proofs: change.task.proofs || [] }, ...tasks];
    const next = tasks.slice();
    next[index] = { ...tasks[index], ...change.task, proofs: tasks[index].proofs || [] };
    return next;
  }
  if (change.type === 'delete' && change.id) {
    return tasks.some((t) => t.id === change.id) ? tasks.filter((t) => t.id !== change.id) : tasks;
  }
  if (change.type === 'proof-added' && change.proof) {
    return tasks.map((t) => {
      if (t.id !== change.taskId) return t;
      const proofs = t.proofs || [];
      return proofs.some((p) => p.id === change.proof.id) ? t : { ...t, proofs: [...proofs, change.proof] };
    });
  }
  if (change.type === 'proof-removed' && change.proofId) {
    return tasks.map((t) => ((t.proofs || []).some((p) => p.id === change.proofId)
      ? { ...t, proofs: t.proofs.filter((p) => p.id !== change.proofId) }
      : t));
  }
  return tasks;
}

module.exports = { applyLiveChange };
