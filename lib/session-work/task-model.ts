import { Type, type Static } from 'typebox'
import { Check } from 'typebox/value'

const text = (maxLength: number) => Type.String({ maxLength })
const id = Type.String({ minLength: 1, maxLength: 80 })
const status = Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed')])
const metadata = Type.Record(Type.String({ maxLength: 80 }), Type.Union([text(1000), Type.Null()]), {
  maxProperties: 16,
})
const fields = {
  subject: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  description: Type.Optional(text(8000)),
  owner: Type.Optional(text(200)),
  metadata: Type.Optional(metadata),
  blockedBy: Type.Optional(Type.Array(id, { maxItems: 32, uniqueItems: true })),
  status: Type.Optional(status),
}
export const taskParameters = {
  mh_task_create: Type.Object(
    {
      subject: Type.String({ minLength: 1, maxLength: 500 }),
      description: Type.Optional(text(8000)),
      owner: Type.Optional(text(200)),
      metadata: Type.Optional(metadata),
    },
    { additionalProperties: false },
  ),
  mh_task_get: Type.Object({ id }, { additionalProperties: false }),
  mh_task_list: Type.Object({}, { additionalProperties: false }),
  mh_task_update: Type.Object(
    { id, expected_revision: Type.Integer({ minimum: 1 }), ...fields, delete: Type.Optional(Type.Boolean()) },
    { additionalProperties: false },
  ),
}
export type TaskTool = keyof typeof taskParameters
export const taskTools = Object.keys(taskParameters) as TaskTool[]
export type Task = {
  id: string
  revision: number
  subject: string
  description: string
  owner: string
  metadata: Record<string, string>
  blockedBy: string[]
  status: Static<typeof status>
  completedTurn: number | null
}
const taskSchema = Type.Object(
  {
    id,
    revision: Type.Integer({ minimum: 1 }),
    subject: Type.String({ minLength: 1, maxLength: 500 }),
    description: text(8000),
    owner: text(200),
    metadata: Type.Record(Type.String(), text(1000), { maxProperties: 16 }),
    blockedBy: Type.Array(id, { maxItems: 32, uniqueItems: true }),
    status,
    completedTurn: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false },
)
const configSchema = Type.Object(
  {
    view: Type.Union([Type.Literal('quiet'), Type.Literal('compact'), Type.Literal('off')]),
    retention: Type.Union([Type.Literal('never'), Type.Literal('four-turns')]),
    reminders: Type.Boolean(),
  },
  { additionalProperties: false },
)
const operationSchema = Type.Union([
  Type.Object({ kind: Type.Literal('put'), task: taskSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('delete'), id }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('tick') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('config'), config: configSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('clear-completed') }, { additionalProperties: false }),
])
export type TaskOperation = Static<typeof operationSchema>
export type TaskState = { tasks: Task[]; turn: number; config: Static<typeof configSchema> }
export const emptyTasks = (): TaskState => ({
  tasks: [],
  turn: 0,
  config: { view: 'quiet', retention: 'never', reminders: false },
})
export const isTaskOperation = (value: unknown): value is TaskOperation => Check(operationSchema, value)
function retainTasks(state: TaskState, keep: (task: Task) => boolean): Task[] {
  const retained = state.tasks.filter(keep)
  const ids = new Set(retained.map((task) => task.id))
  return retained.map((task) => {
    const blockedBy = task.blockedBy.filter((id) => ids.has(id))
    return blockedBy.length === task.blockedBy.length
      ? task
      : { ...task, revision: task.revision + 1, blockedBy }
  })
}
export function reduceTasks(state: TaskState, op: TaskOperation): TaskState {
  if (op.kind === 'config') return { ...state, config: { ...op.config } }
  if (op.kind === 'clear-completed')
    return { ...state, tasks: retainTasks(state, (t) => t.status !== 'completed') }
  if (op.kind === 'tick') {
    const turn = state.turn + 1
    return {
      ...state,
      turn,
      tasks: retainTasks(
        state,
        (t) =>
          state.config.retention !== 'four-turns' || t.completedTurn === null || turn - t.completedTurn < 4,
      ),
    }
  }
  if (op.kind === 'delete') {
    if (!state.tasks.some((t) => t.id === op.id)) throw new Error('Task not found.')
    return {
      ...state,
      tasks: retainTasks(state, (t) => t.id !== op.id),
    }
  }
  const prior = state.tasks.find((t) => t.id === op.task.id)
  if (op.task.revision !== (prior?.revision ?? 0) + 1) throw new Error('Task revision conflict.')
  if (!prior && state.tasks.length >= 64)
    throw new Error('At most 64 session steps; delete or clear completed steps first.')
  if (op.task.blockedBy.some((id) => id === op.task.id || !state.tasks.some((t) => t.id === id)))
    throw new Error('Dependencies must name existing other session steps.')
  const tasks = prior
    ? state.tasks.map((t) => (t.id === op.task.id ? op.task : t))
    : [...state.tasks, op.task]
  const visited = new Set<string>()
  const visit = (id: string, path: Set<string>): void => {
    if (visited.has(id)) return
    if (path.has(id)) throw new Error('Dependency cycle rejected.')
    const next = new Set(path)
    next.add(id)
    for (const dep of tasks.find((t) => t.id === id)?.blockedBy ?? []) visit(dep, next)
    visited.add(id)
  }
  visit(op.task.id, new Set())
  return { ...state, tasks }
}
export function taskProjection(state: TaskState, task: Task) {
  return {
    ...task,
    blocks: state.tasks.filter((t) => t.blockedBy.includes(task.id)).map((t) => t.id),
    open_blockers: task.blockedBy.filter(
      (id) => state.tasks.find((t) => t.id === id)?.status !== 'completed',
    ),
    completion_meaning: 'Session step only; not worker execution, tsk outcome or human acceptance.',
  }
}
