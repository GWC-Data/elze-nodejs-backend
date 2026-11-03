import { describe, expect, it, vi } from 'vitest';
import { isRbacReady } from '../../src/modules/system/bootstrapService';
import { health } from '../../src/modules/system/healthController';

vi.mock('../../src/modules/system/bootstrapService', () => ({ isRbacReady: vi.fn() }));
vi.mock('../../src/shared/email/emailService', () => ({ describeTransport: () => ({ provider: 'smtp' }) }));

function fakeResponse() {
  const res: any = { locals: {}, headers: {} };
  res.status = vi.fn(() => res);
  res.set = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

function sent(res: any) {
  return res.json.mock.calls[0][0];
}

describe('health', () => {
  it('answers 200 once the service is ready', () => {
    vi.mocked(isRbacReady).mockReturnValue(true);
    const res = fakeResponse();
    health({} as any, res);
    expect(res.status).toHaveBeenLastCalledWith(200);
    expect(sent(res)).toEqual({ success: true, data: { status: 'ok', detail: null, email: 'smtp' } });
  });

  it('answers 503 while the service is starting, without the internal error', () => {
    vi.mocked(isRbacReady).mockReturnValue(false);
    const res = fakeResponse();
    health({} as any, res);
    expect(res.status).toHaveBeenLastCalledWith(503);
    expect(sent(res).data).toEqual({
      status: 'starting',
      detail: 'The access catalogue is still loading.',
      email: 'smtp',
    });
  });
});
