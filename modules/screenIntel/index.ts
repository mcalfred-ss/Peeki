export { buildScreenElementMap } from './map'
export { scanUiAutomation, diagnoseDesktopUia } from './uia'
export { scanOcr } from './ocr'
export {
  resolveTarget,
  extractSearchQueries,
  formatMapForPrompt,
  formatDesktopInventoryForPrompt,
  isStrongMatch,
  shouldPreferOverVision,
  listRankedCandidates
} from './resolve'
export {
  isPointingRequest,
  isInventoryRequest,
  isBareTargetLabel,
  isProgressRequest,
  isCoachingRequest,
  inferPointingHint,
  inferUserTargetIntent,
  categorizeElement
} from './intent'
export { localizeTargetInRegion, inferSearchRegion } from './localize'
export { logTargetPipeline, logCaptureTransform, marksFromMatch } from './debugLog'
export { invokeOrClick } from './invoke'
export { runPhysicalCalibration, calibrationMarks, moveCursorPhysical } from './calibration'
export {
  physicalToDipPoint,
  dipToPhysicalPoint,
  physicalRectToDip,
  rectCenter,
  normalizedToPhysical
} from './coords'
export { validateCanonicalTarget, nameRelatesToRequest } from './validate'
export { normalizeName, compactName, namesMatch } from './normalize'
export {
  buildInventoryDecision,
  buildLocateDecision,
  buildProgressDecision,
  collectDesktopInventory
} from './localAnswer'
export {
  setCoachTrack,
  getCoachTrack,
  advanceCoachTrack,
  clearCoachTrack,
  noteCoachScreen
} from './coachTrack'
export { filterCoachingHighlights, inferForegroundAppName, isPeekiUiName } from './coachFilter'
export { verifyAndContinue } from './progressVerify'
export { planSession, inferRecommendedMode, wantsComputerAction } from './sessionPlan'
export type { SessionPlan } from './sessionPlan'
