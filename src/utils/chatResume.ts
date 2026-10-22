import type { ChatResponseData } from '../api/chat';

export type ResumeFailureAction = 'keep' | 'clear' | 'reload';

export type ResumeFailure = {
  code?: string;
  action: ResumeFailureAction;
  titleKey: string;
  messageKey: string;
};

/**
 * Map a failed `POST /api/chat/resume` onto a user-visible outcome.
 * `keep` leaves the approval card up (the action is still pending).
 * `clear` dismisses it (the server already finished the action).
 * `reload` pulls history because this card's interruptId is stale.
 */
export function classifyResumeFailure(
  code: string | undefined,
  statusCode?: number,
): ResumeFailure {
  if (code === 'resume_in_progress') {
    return {
      code,
      action: 'keep',
      titleKey: 'ai.approvalInProgressTitle',
      messageKey: 'ai.approvalInProgress',
    };
  }
  if (code === 'interrupt_mismatch') {
    return {
      code,
      action: 'reload',
      titleKey: 'ai.approvalMismatchTitle',
      messageKey: 'ai.approvalMismatch',
    };
  }
  if (code === 'tool_args_invalid') {
    return {
      code,
      action: 'clear',
      titleKey: 'ai.approvalInvalidTitle',
      messageKey: 'ai.approvalInvalid',
    };
  }
  if (code === 'target_missing') {
    return {
      code,
      action: 'clear',
      titleKey: 'ai.approvalMissingTitle',
      messageKey: 'ai.approvalMissing',
    };
  }
  if (code === 'no_pending_action' || statusCode === 404) {
    return {
      code,
      action: 'clear',
      titleKey: 'ai.approvalNoneTitle',
      messageKey: 'ai.approvalNone',
    };
  }
  return {
    code,
    action: 'keep',
    titleKey: 'ai.approvalErrorTitle',
    messageKey: 'ai.approvalError',
  };
}

/** 200 body whose approval was older than 20 minutes and was not applied. */
export function isExpiredApproval(data: ChatResponseData | null | undefined): boolean {
  const expired = data?.data?.expired;
  return expired === true;
}
