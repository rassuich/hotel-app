/**
 * Bill/folio boundary. The app's own request history is NOT the hotel bill and
 * is never presented as one. Real folio content requires a configured source
 * and an explicitly authorized recipient (guest_session.bill_access).
 */
export interface BillLine {
  date: string;
  description: string;
  amountMinor: number;
}
export interface BillDocument {
  currency: string;
  lines: BillLine[];
  balanceMinor: number;
  asOf: string;
  source: string;
}

export interface BillProvider {
  readonly id: string;
  readonly configured: boolean;
  getBill(stay: { id: string; propertyId: string; externalRef: string | null }): Promise<BillDocument>;
}

export class UnconfiguredBillProvider implements BillProvider {
  readonly id = 'none';
  readonly configured = false;
  async getBill(): Promise<BillDocument> {
    throw new Error('Bill provider not configured');
  }
}
