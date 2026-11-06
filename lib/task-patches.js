function rollbackTaskPatch(tasks, taskId, previousFields) {
  return tasks.map((task) => task.id === taskId ? { ...task, ...previousFields } : task);
}

module.exports = { rollbackTaskPatch };
