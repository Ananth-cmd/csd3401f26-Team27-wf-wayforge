// Works out the 3D campus building outlines off the main thread, so the map never freezes (see massing.ts).
import { buildMassing } from './massing'
import type { MassInput } from './massing'

self.onmessage = (e: MessageEvent<MassInput>) => { self.postMessage(buildMassing(e.data)) }
