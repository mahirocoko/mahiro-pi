import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { registerNativeUtilities } from '../lib/native-utilities.ts'
import { registerWorkflowHub } from '../lib/workflow-hub.ts'

export default function nativeUtilities(pi: ExtensionAPI) {
  registerNativeUtilities(pi)
  registerWorkflowHub(pi)
}
