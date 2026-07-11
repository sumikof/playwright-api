import { ulid } from 'ulid'

export function newRunId(): string {
  return ulid()
}
