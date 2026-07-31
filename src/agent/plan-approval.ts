import crypto from 'crypto';

export type PlanStatus = 'pending' | 'approved' | 'rejected' | 'executing' | 'executed' | 'failed';

export interface PlanRecord {
  id: string;
  sessionId: string;
  content: string;
  status: PlanStatus;
  createdAt: number;
  feedback?: string;
  error?: string;
}

export type PlanTransitionResult = { ok: true; plan: PlanRecord } | { ok: false; error: string };

export class PlanApprovalStore {
  private plans = new Map<string, PlanRecord>();
  private currentBySession = new Map<string, string>();

  propose(sessionId: string, content: string): PlanRecord {
    const current = this.getCurrent(sessionId);
    if (
      current?.status === 'pending' ||
      current?.status === 'approved' ||
      current?.status === 'executing'
    ) {
      throw new Error('This session already has an active plan.');
    }
    const plan: PlanRecord = {
      id: crypto.randomUUID(),
      sessionId,
      content,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.plans.set(plan.id, plan);
    this.currentBySession.set(sessionId, plan.id);
    return { ...plan };
  }

  getCurrent(sessionId: string): PlanRecord | null {
    const id = this.currentBySession.get(sessionId);
    const plan = id ? this.plans.get(id) : undefined;
    return plan ? { ...plan } : null;
  }

  approve(sessionId: string, planId: string): PlanTransitionResult {
    return this.transition(sessionId, planId, 'pending', 'approved');
  }

  reject(sessionId: string, planId: string, feedback?: string): PlanTransitionResult {
    const result = this.transition(sessionId, planId, 'pending', 'rejected');
    if (result.ok && feedback) {
      const stored = this.plans.get(planId)!;
      stored.feedback = feedback;
      return { ok: true, plan: { ...stored } };
    }
    return result;
  }

  async executeOnce<T>(
    sessionId: string,
    planId: string,
    execute: (plan: PlanRecord) => Promise<T>
  ): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    const started = this.transition(sessionId, planId, 'approved', 'executing');
    if (!started.ok) return started;
    try {
      const value = await execute(started.plan);
      const plan = this.plans.get(planId)!;
      plan.status = 'executed';
      return { ok: true, value };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const plan = this.plans.get(planId)!;
      plan.status = 'failed';
      plan.error = message;
      return { ok: false, error: message };
    }
  }

  private transition(
    sessionId: string,
    planId: string,
    from: PlanStatus,
    to: PlanStatus
  ): PlanTransitionResult {
    const plan = this.plans.get(planId);
    if (!plan || plan.sessionId !== sessionId || this.currentBySession.get(sessionId) !== planId) {
      return { ok: false, error: 'Plan is invalid or stale.' };
    }
    if (plan.status !== from) {
      return { ok: false, error: `Plan cannot transition from ${plan.status} to ${to}.` };
    }
    plan.status = to;
    return { ok: true, plan: { ...plan } };
  }
}

export const PlanApprovals = new PlanApprovalStore();
