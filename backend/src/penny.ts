// Penny: a SIMULATED accounts-payable AI agent (stated in the README). It reads invoices with fixed
// rules and is deliberately gullible: an instruction hidden in an invoice always overrides what it parsed.
// Its proposals go through exactly the same rules as anyone else's.
import fs from 'node:fs';
import { createRequest, HttpError, type PaymentRequest } from './payments.ts';

const INVOICES = new URL('../data/invoices/', import.meta.url);

type Proposal = { vendorId: string; account: string; amount: number; purpose: string };

function read(text: string): Proposal {
  const field = (name: string) => text.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'))?.[1].trim() ?? '';
  const proposal = {
    vendorId: field('Vendor'),
    account: field('Account'),
    amount: Number(field('Amount').replace(/,/g, '')),
    purpose: field('Description'),
  };
  // The prompt injection "works" on Penny.
  const injected = text.match(/pay \$?([\d,]+) to account ([\w-]+)/i);
  if (injected) Object.assign(proposal, { amount: Number(injected[1].replace(/,/g, '')), account: injected[2] });
  return proposal;
}

export function runPenny(): { invoice: string; request: PaymentRequest; blocked?: string }[] {
  return fs.readdirSync(INVOICES).filter((f) => f.endsWith('.txt')).sort().map((invoice) => {
    const proposal = read(fs.readFileSync(new URL(invoice, INVOICES), 'utf8'));
    try {
      return { invoice, request: createRequest(proposal, 'penny', 'penny') };
    } catch (e) {
      if (e instanceof HttpError && e.request) return { invoice, request: e.request, blocked: e.message };
      throw e;
    }
  });
}
