import { defineErrorTranslations, type ErrorsByCode } from '@qualy/i18n-contract'
import { selectKey } from '@qualy/i18n-contract'
import type * as assessmentErrors from '../errors.ts'
import * as m from '#messages'

// What this plugin's screens say is in messages/<locale>.json, called as
// functions from #messages where it is said. What is left here is the
// failures its api can answer with, each with its sentence.

export const errorMessages = defineErrorTranslations<ErrorsByCode<typeof assessmentErrors>>()({
  ASSESSMENT_BATCH_NOT_FOUND: m.error_batchNotFound,
  ASSESSMENT_PHASE_NOT_FOUND: m.error_phaseNotFound,
  ASSESSMENT_PARTICIPANT_NOT_FOUND: m.error_participantNotFound,
  ASSESSMENT_PARTICIPANT_INVALID: m.error_participantInvalid,
  ASSESSMENT_TEMPLATE_NOT_FOUND: m.error_templateNotFound,
  ASSESSMENT_TEMPLATE_CONFLICT: m.error_templateConflict,
  ASSESSMENT_BATCH_READ_ONLY: m.error_batchReadOnly,
  ASSESSMENT_BATCH_STATUS_INVALID: {
    message: m.error_batchStatusInvalid,
    values: (data) => ({
      refusal: selectKey(data.refusal ?? 'other'),
      openRounds: data.openRounds ?? 0,
    }),
  },
  ASSESSMENT_BATCH_NO_PARTICIPANTS: m.error_batchNoParticipants,
  ASSESSMENT_BATCH_REFERENCE_INVALID: m.error_batchReferenceInvalid,
  ASSESSMENT_PLAN_INVALID: m.error_planInvalid,
  ASSESSMENT_ADVANCE_INVALID: m.error_advanceInvalid,
  ASSESSMENT_ACCESS_INVALID: {
    message: m.error_accessInvalid,
    values: (data) => ({ reason: selectKey(data.reason) }),
  },
  ASSESSMENT_MATERIAL_RANGE_INVALID: m.error_materialRangeInvalid,
  ASSESSMENT_ENTRY_NOT_FOUND: m.error_entryNotFound,
  ASSESSMENT_ENTRY_ACTION_REFUSED: m.error_entryActionRefused,
  ASSESSMENT_ENTRY_PAYLOAD_INVALID: m.error_entryPayloadInvalid,
  ASSESSMENT_ITEM_REVISION_CONFLICT: m.error_itemRevisionConflict,
  ASSESSMENT_ITEM_ACTION_REFUSED: m.error_itemActionRefused,
  ASSESSMENT_ATTACHMENT_NOT_FOUND: m.error_attachmentNotFound,
  ASSESSMENT_REVIEW_NOT_FOUND: m.error_reviewNotFound,
  ASSESSMENT_REVIEW_CONFLICT: m.error_reviewConflict,
  ASSESSMENT_ITEM_NOT_FOUND: m.error_itemNotFound,
  ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED: m.error_itemChangeDecisionRequired,
  ASSESSMENT_ITEM_CONFIG_INVALID: m.error_itemConfigInvalid,
  ASSESSMENT_SCORE_GROUP_INVALID: m.error_scoreGroupInvalid,
  ASSESSMENT_SCORE_GROUP_VERSION_CONFLICT: m.error_scoreGroupVersionConflict,
  ASSESSMENT_DETERMINATION_REFUSED: {
    message: m.error_determinationRefused,
    values: (data) => ({ reason: data.reason }),
  },
  ASSESSMENT_SCORING_UNAVAILABLE: m.error_scoringUnavailable,
  ASSESSMENT_SCORING_ACCOUNT_TOO_LARGE: m.error_scoringAccountTooLarge,
  ASSESSMENT_ADMINISTRATIVE_IMPORT_NOT_FOUND: m.error_administrativeImportNotFound,
  // the issues themselves are drawn row by row on the preview; this is the
  // sentence for the moment the api refuses, which is a different place
  ASSESSMENT_ADMINISTRATIVE_IMPORT_INVALID: m.error_administrativeImportInvalid,
  ASSESSMENT_ADMINISTRATIVE_IMPORT_BUSY: m.error_administrativeImportBusy,
  ASSESSMENT_PARTICIPANT_PLACEMENT_CHANGED: m.error_participantPlacementChanged,
  ASSESSMENT_ADMINISTRATIVE_RECORD_TARGETS_CHANGED: m.error_administrativeRecordTargetsChanged,
  ASSESSMENT_ADMINISTRATIVE_RECORD_FILES_NOT_SHAREABLE:
    m.error_administrativeRecordFilesNotShareable,
  ASSESSMENT_ADMINISTRATIVE_RECORD_NOT_FOUND: m.error_administrativeRecordNotFound,
  ASSESSMENT_ADMINISTRATIVE_RECORD_REFUSED: m.error_administrativeRecordRefused,
  ASSESSMENT_ITEM_SCORING_INCOMPATIBLE: {
    message: m.error_itemScoringIncompatible,
    values: (data) => {
      const refused = data.approved.refused + (data.derived?.refused === true ? 1 : 0)
      const executionFailed =
        data.approved.executionFailed + (data.derived?.executionFailed === true ? 1 : 0)
      return {
        // a question nobody files has no determinations in force: what
        // failed is its own rule, tried as it is published or restored
        case: data.derived !== null && data.approved.total === 0 ? 'derived' : 'standing',
        affected: refused + executionFailed,
        refused,
        executionFailed,
      }
    },
  },
}).registry
