import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerNativeUtilities } from "../lib/native-utilities.ts";

export default function nativeUtilities(pi: ExtensionAPI) {
  registerNativeUtilities(pi);
}
