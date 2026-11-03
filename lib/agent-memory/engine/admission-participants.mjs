// One native-MJS owner across native and Jiti loaders. Actual references only;
// neither a PID nor a deserialized acknowledgement can populate this table.
const participants = new Map()
export function registerParticipant(key, value) {
  if (participants.has(key)) throw Error('Duplicate memory admission participant')
  participants.set(key, value)
}
export function memoryParticipant(key) {
  return participants.get(key)
}
export function forgetParticipant(key, value) {
  if (participants.get(key) === value) participants.delete(key)
}
