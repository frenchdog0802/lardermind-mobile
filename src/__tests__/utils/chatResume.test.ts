import { classifyResumeFailure, isExpiredApproval } from '../../utils/chatResume';
import type { ChatResponseData } from '../../api/chat';

describe('chat resume contract', () => {
  it('keeps the card while another resume is in progress', () => {
    expect(classifyResumeFailure('resume_in_progress', 409)).toMatchObject({
      action: 'keep',
      messageKey: 'ai.approvalInProgress',
    });
  });

  it('reloads history when the displayed interrupt does not match', () => {
    expect(classifyResumeFailure('interrupt_mismatch', 409)).toMatchObject({
      action: 'reload',
      messageKey: 'ai.approvalMismatch',
    });
  });

  it('clears the card when the action can no longer be applied', () => {
    expect(classifyResumeFailure('tool_args_invalid', 400).action).toBe('clear');
    expect(classifyResumeFailure('target_missing', 409).action).toBe('clear');
    expect(classifyResumeFailure('no_pending_action', 404).action).toBe('clear');
    expect(classifyResumeFailure(undefined, 404).action).toBe('clear');
  });

  it('recognizes an expired approval that returned 200', () => {
    const expired: ChatResponseData = {
      type: 'text',
      message: 'That approval expired, so I did not make the changes.',
      data: { expired: true, interruptId: 'old-1' },
    };
    expect(isExpiredApproval(expired)).toBe(true);
    expect(
      isExpiredApproval({
        type: 'pantry_updated',
        message: 'Added butter.',
        data: { interruptId: 'int-1' },
      }),
    ).toBe(false);
  });
});