// Canonical feature DATA authority only; never generic profile/filesystem authority.
import { createHash } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export function assertSafeContainer(path: string) {
  if (!isAbsolute(path) || resolve(path) !== path || /[\x00-\x1f\x7f]/.test(path))
    throw Error('Canonical feature container required')
  let current = path
  for (;;) {
    try {
      const s = lstatSync(current)
      if (
        s.isSymbolicLink() ||
        !s.isDirectory() ||
        (s.mode & 0o022) !== 0 ||
        (process.getuid && s.uid !== process.getuid() && s.uid !== 0) ||
        realpathSync(current) !== current
      )
        throw Error('Unsafe feature container ancestor')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (dirname(current) === current) break
    current = dirname(current)
  }
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
export const featureNamespaces = (profile: string) => [
  {
    prefix: 'goal_state',
    root: join(profile, 'workflow/goals'),
    tools: ['mh_get_goal', 'mh_create_goal', 'mh_update_goal', 'mh_clear_goal'],
  },
  {
    prefix: 'code_evidence_state',
    root: join(profile, 'workflow/evidence'),
    tools: ['mh_code_evidence'],
  },
  {
    prefix: 'ux_workflow_state',
    root: join(profile, 'workflow/ux-workflow'),
    tools: ['mh_get_ux_workflow', 'mh_create_ux_workflow', 'mh_update_ux_workflow'],
  },
  {
    prefix: 'execution_run_state',
    root: join(profile, 'workflow/execution-run'),
    tools: ['mh_execution_run'],
  },
  {
    prefix: 'rtk_state',
    root: join(profile, 'preferences/rtk'),
    tools: ['mh_rtk'],
  },
  {
    prefix: 'usage_state',
    root: join(profile, 'preferences/usage'),
    tools: [],
  },
  {
    prefix: 'own_ui_state',
    root: join(profile, 'preferences/own-ui'),
    tools: [],
  },
]
export function featureCapability(prefix: string, leaf: string) {
  // Preference namespaces are profile-wide ROOTS, not project leaves.
  const namespace = ['rtk_state', 'own_ui_state', 'usage_state'].includes(prefix) ? leaf : dirname(leaf)
  return `${prefix}_data_${hash(namespace)}`
}
export const sessionTrackingTools = [
  'mh_task_create',
  'mh_task_get',
  'mh_task_list',
  'mh_task_update',
] as const
export function featureGrants(profile: string) {
  return [
    ...sessionTrackingTools,
    'mh_code_map',
    ...featureNamespaces(profile).flatMap(({ prefix, root, tools }) => [
      ...tools,
      `${prefix}_data_${hash(root)}`,
    ]),
  ]
}
