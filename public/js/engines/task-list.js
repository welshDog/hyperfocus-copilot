// engines/task-list.js
// Task List Engine — v1
// Local-first task store. The copilot's copy ("I've picked your top task")
// is only honest if a real task actually exists — this is that task.
//
// PRD v1 scope: "One integration: pull tasks from a simple text list / localStorage".
// Sync to Supabase (`tasks` table) is deliberately v2.

const STORAGE_KEY = 'hfc_tasks_v1';
const MAX_TASKS = 100;
const MAX_TITLE = 200;

class TaskListEngine extends EventTarget {
  constructor() {
    super();
    this.tasks = this.load();
  }

  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tasks));
    } catch {
      // Storage full or blocked (private mode). Keep working in-memory —
      // a copilot that throws on a full disk is worse than one that forgets.
    }
    this.dispatchEvent(new CustomEvent('tasks-changed', { detail: this.tasks }));
  }

  /** All tasks, newest-added last, in user-controlled order. */
  all() {
    return this.tasks;
  }

  /** Tasks still to do — this is what every mode reasons about. */
  active() {
    return this.tasks.filter(t => !t.done);
  }

  /** The one task the copilot commits to. Null when the list is empty. */
  top() {
    return this.active()[0] || null;
  }

  hasAny() {
    return this.active().length > 0;
  }

  add(title) {
    const clean = String(title || '').trim().slice(0, MAX_TITLE);
    if (!clean) return null;
    if (this.tasks.length >= MAX_TASKS) return null;

    const task = {
      id: crypto.randomUUID?.() || `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: clean,
      done: false,
      createdAt: Date.now(),
      completedAt: null
    };
    this.tasks.push(task);
    this.save();
    return task;
  }

  get(id) {
    return this.tasks.find(t => t.id === id) || null;
  }

  complete(id) {
    const task = this.get(id);
    if (!task || task.done) return null;
    task.done = true;
    task.completedAt = Date.now();
    this.save();
    return task;
  }

  uncomplete(id) {
    const task = this.get(id);
    if (!task || !task.done) return null;
    task.done = false;
    task.completedAt = null;
    this.save();
    return task;
  }

  remove(id) {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter(t => t.id !== id);
    if (this.tasks.length === before) return false;
    this.save();
    return true;
  }

  /**
   * Move a task to the front of the list — "this is the one".
   * The whole point of the freeze-rescue flow is picking ONE thing,
   * so promoting is the primary reorder gesture (no drag-and-drop:
   * fiddly targets are exactly what a frozen brain can't do).
   */
  promote(id) {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx <= 0) return false;
    const [task] = this.tasks.splice(idx, 1);
    this.tasks.unshift(task);
    this.save();
    return true;
  }

  /** Drop finished tasks. Returns how many were cleared. */
  clearDone() {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter(t => !t.done);
    const removed = before - this.tasks.length;
    if (removed) this.save();
    return removed;
  }
}

export const taskList = new TaskListEngine();
