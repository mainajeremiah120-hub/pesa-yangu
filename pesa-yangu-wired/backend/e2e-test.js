"use strict";
// End-to-end test against the locally-running server (same code as
// production master, same production database). Credentials are read
// from environment variables only — never written to this file.
const BASE = "http://localhost:3987/api/v1";
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error("Set TEST_EMAIL and TEST_PASSWORD env vars"); process.exit(1); }

let token = "";
const results = [];
const created = { wallets: [], categories: [], loans: [], policies: [], investments: [], goals: [], txs: [] };

function pass(name, detail="") { results.push({name, ok:true, detail}); console.log(`  PASS  ${name}${detail?" — "+detail:""}`); }
function fail(name, detail="") { results.push({name, ok:false, detail}); console.log(`  FAIL  ${name}${detail?" — "+detail:""}`); }

async function api(method, path, body, opts={}) {
  const headers = { "Content-Type": "application/json" };
  const useToken = opts.token !== undefined ? opts.token : token;
  if (useToken) headers.Authorization = `Bearer ${useToken}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const approx = (a,b,eps=0.01) => Math.abs(parseFloat(a)-parseFloat(b)) <= eps;

async function run() {
  console.log("=== LOGIN ===");
  {
    const { status, json } = await api("POST", "/auth/login", { email: EMAIL, password: PASSWORD });
    if (status !== 200 || !json?.accessToken) { console.error("Login failed:", status, json); process.exit(1); }
    token = json.accessToken;
    pass("login");
  }

  console.log("=== WALLETS ===");
  let walA, walB, walC;
  {
    const a = await api("POST", "/wallets", { name:"E2E Wallet A", balance:200000 });
    const b = await api("POST", "/wallets", { name:"E2E Wallet B", balance:0 });
    const c = await api("POST", "/wallets", { name:"E2E Wallet C (throwaway)", balance:0 });
    walA = a.json?.wallet; walB = b.json?.wallet; walC = c.json?.wallet;
    created.wallets.push(walA?.id, walB?.id, walC?.id);
    (walA && walB && walC) ? pass("create 3 wallets") : fail("create 3 wallets", JSON.stringify([a.json,b.json,c.json]));
  }

  console.log("=== TRANSACTIONS: basic CRUD + balance math ===");
  let txId;
  {
    const before = parseFloat(walA.balance);
    const { json: exp } = await api("POST", "/transactions", { wallet_id: walA.id, type:"expense", amount_kes: 500 });
    txId = exp?.transaction?.id; created.txs.push(txId);
    const { json: w1 } = await api("GET", "/wallets");
    const bal1 = w1.wallets.find(w=>w.id===walA.id).balance;
    approx(bal1, before-500) ? pass("expense debits wallet") : fail("expense debits wallet", `expected ${before-500}, got ${bal1}`);

    await api("PATCH", `/transactions/${txId}`, { amount_kes: 800 });
    const { json: w2 } = await api("GET", "/wallets");
    const bal2 = w2.wallets.find(w=>w.id===walA.id).balance;
    approx(bal2, before-800) ? pass("edit tx recalculates balance") : fail("edit tx recalculates balance", `expected ${before-800}, got ${bal2}`);

    await api("DELETE", `/transactions/${txId}`);
    const { json: w3 } = await api("GET", "/wallets");
    const bal3 = w3.wallets.find(w=>w.id===walA.id).balance;
    approx(bal3, before) ? pass("delete tx reverses balance") : fail("delete tx reverses balance", `expected ${before}, got ${bal3}`);
  }

  console.log("=== TRANSACTIONS: double-submit dedupe ===");
  {
    const payload = { wallet_id: walA.id, type:"expense", amount_kes: 111 };
    const [r1, r2] = await Promise.all([api("POST","/transactions",payload), api("POST","/transactions",payload)]);
    const statuses = [r1.status, r2.status].sort();
    if (statuses[0]===201 && statuses[1]===409) pass("duplicate transaction rejected");
    else fail("duplicate transaction rejected", `statuses: ${statuses}`);
    const okOne = [r1,r2].find(r=>r.status===201);
    if (okOne?.json?.transaction?.id) created.txs.push(okOne.json.transaction.id);
  }

  console.log("=== WALLET EDIT: stale-balance fix + auto-logged adjustment ===");
  {
    const { json: wBefore } = await api("GET","/wallets");
    const balBefore = wBefore.wallets.find(w=>w.id===walA.id).balance;
    await api("PATCH", `/wallets/${walA.id}`, { name:"E2E Wallet A (renamed)" });
    const { json: wAfter } = await api("GET","/wallets");
    const balAfter = wAfter.wallets.find(w=>w.id===walA.id).balance;
    approx(balAfter, balBefore) ? pass("editing name only leaves balance untouched") : fail("editing name only leaves balance untouched", `${balBefore} -> ${balAfter}`);

    const newBal = parseFloat(balAfter) + 250;
    const { json: adj } = await api("PATCH", `/wallets/${walA.id}`, { balance: newBal });
    const gotAdjustment = !!adj?.adjustment;
    const balMatches = approx(adj?.wallet?.balance, newBal);
    (gotAdjustment && balMatches) ? pass("direct balance edit auto-logs adjustment transaction") : fail("direct balance edit auto-logs adjustment", JSON.stringify(adj));
    if (adj?.adjustment?.id) created.txs.push(adj.adjustment.id);
  }

  console.log("=== TRANSFERS ===");
  {
    const { json: wBefore } = await api("GET","/wallets");
    const aBefore = parseFloat(wBefore.wallets.find(w=>w.id===walA.id).balance);
    const bBefore = parseFloat(wBefore.wallets.find(w=>w.id===walB.id).balance);
    const { status, json } = await api("POST", "/wallets/transfer", { from_wallet_id: walA.id, to_wallet_id: walB.id, amount_kes: 1000 });
    const { json: wAfter } = await api("GET","/wallets");
    const aAfter = parseFloat(wAfter.wallets.find(w=>w.id===walA.id).balance);
    const bAfter = parseFloat(wAfter.wallets.find(w=>w.id===walB.id).balance);
    (status===200 && approx(aAfter,aBefore-1000) && approx(bAfter,bBefore+1000)) ? pass("transfer moves money correctly") : fail("transfer moves money correctly", `A:${aBefore}->${aAfter} B:${bBefore}->${bAfter}`);

    const { status: s2 } = await api("POST", "/wallets/transfer", { from_wallet_id: walB.id, to_wallet_id: walA.id, amount_kes: 999999999 });
    s2===400 ? pass("transfer overdraft rejected") : fail("transfer overdraft rejected", `status ${s2}`);
  }

  console.log("=== CATEGORIES: allocation, reparent type-check, unlink cleanup ===");
  {
    const { json: exCat } = await api("POST","/categories",{ name:"E2E Expense Cat", type:"expense" });
    const { json: inCat } = await api("POST","/categories",{ name:"E2E Income Cat", type:"income" });
    const { json: subCat } = await api("POST","/categories",{ name:"E2E Sub Cat", type:"expense", parent_id: exCat.category.id });
    created.categories.push(exCat.category.id, inCat.category.id, subCat.category.id);
    (exCat.category && inCat.category && subCat.category) ? pass("create categories + sub-category") : fail("create categories + sub-category");

    const { status: badReparent } = await api("PATCH", `/categories/${subCat.category.id}`, { parent_id: inCat.category.id });
    badReparent===400 ? pass("reparent to different type rejected") : fail("reparent to different type rejected", `status ${badReparent}`);

    const { json: wNow } = await api("GET","/wallets");
    const walABal = parseFloat(wNow.wallets.find(w=>w.id===walA.id).balance);
    await api("PATCH", `/categories/${exCat.category.id}`, { linked_wallet_id: walA.id });
    const { status: overAlloc } = await api("PATCH", `/categories/${exCat.category.id}/allocate`, { amount_kes: walABal + 100000 });
    overAlloc===400 ? pass("over-allocation beyond pool rejected") : fail("over-allocation beyond pool rejected", `status ${overAlloc}`);

    await api("PATCH", `/categories/${exCat.category.id}/allocate`, { amount_kes: 500 });
    const { json: unlinked } = await api("PATCH", `/categories/${exCat.category.id}`, { linked_wallet_id: null });
    approx(unlinked?.category?.account_allocated_kes, 0) ? pass("unlinking zeroes allocation") : fail("unlinking zeroes allocation", JSON.stringify(unlinked?.category));
  }

  console.log("=== LOANS ===");
  {
    const { json: compound } = await api("POST","/loans",{ name:"E2E Compound Loan", principal_kes:10000, remaining_kes:10000, interest_type:"compound" });
    created.loans.push(compound.loan.id);

    const { status: badSplit } = await api("POST", `/loans/${compound.loan.id}/repayments`, { wallet_id: walA.id, total_kes: 1000, principal_kes: 0, interest_kes: 0 });
    badSplit===400 ? pass("compound repayment principal+interest mismatch rejected") : fail("compound repayment mismatch rejected", `status ${badSplit}`);

    const { status: goodRepay, json: goodRepayJson } = await api("POST", `/loans/${compound.loan.id}/repayments`, { wallet_id: walA.id, total_kes: 1000, principal_kes: 800, interest_kes: 200 });
    goodRepay===201 ? pass("valid compound repayment accepted") : fail("valid compound repayment accepted", `status ${goodRepay} ${JSON.stringify(goodRepayJson)}`);

    const { status: overdrawn } = await api("POST", `/loans/${compound.loan.id}/repayments`, { wallet_id: walA.id, total_kes: 999999999, principal_kes: 999999999, interest_kes: 0 });
    overdrawn===400 ? pass("loan repayment overdraft rejected") : fail("loan repayment overdraft rejected", `status ${overdrawn}`);

    const { json: overpayJson } = await api("POST", `/loans/${compound.loan.id}/repayments`, { wallet_id: walA.id, total_kes: 50000, principal_kes: 50000, interest_kes: 0 });
    const excess = overpayJson?.excess_kes;
    (excess && excess > 0) ? pass("overpayment surfaces excess_kes", `excess=${excess}`) : fail("overpayment surfaces excess_kes", JSON.stringify(overpayJson));

    const { json: loanBefore } = await api("GET","/loans");
    const remainingBefore = loanBefore.loans.find(l=>l.id===compound.loan.id).remaining_kes;
    await api("PATCH", `/loans/${compound.loan.id}`, { name:"E2E Compound Loan (renamed)" });
    const { json: loanAfter } = await api("GET","/loans");
    const remainingAfter = loanAfter.loans.find(l=>l.id===compound.loan.id).remaining_kes;
    approx(remainingBefore, remainingAfter) ? pass("editing loan name leaves remaining_kes untouched") : fail("editing loan name leaves remaining_kes untouched", `${remainingBefore} -> ${remainingAfter}`);

    const { json: simple } = await api("POST","/loans",{ name:"E2E Simple Loan", principal_kes:5000, remaining_kes:5000, interest_type:"simple" });
    created.loans.push(simple.loan.id);
    const { status: simpleOk } = await api("POST", `/loans/${simple.loan.id}/repayments`, { wallet_id: walA.id, total_kes: 500, principal_kes: 0, interest_kes: 0 });
    simpleOk===201 ? pass("simple loan repayment doesn't require principal/interest split") : fail("simple loan repayment split not required", `status ${simpleOk}`);
  }

  console.log("=== INSURANCE ===");
  {
    const { json: pol } = await api("POST","/insurance",{ name:"E2E Policy", provider:"Test Co", premium_amount:1000, amount_paid: 2000 });
    created.policies.push(pol.policy.id);

    const { status: payStatus } = await api("POST", `/insurance/${pol.policy.id}/payments`, { wallet_id: walA.id, amount_kes: 300 });
    payStatus===201 ? pass("premium payment accepted") : fail("premium payment accepted", `status ${payStatus}`);

    const { status: lockedEdit } = await api("PATCH", `/insurance/${pol.policy.id}`, { amount_paid: 9999 });
    lockedEdit===400 ? pass("amount_paid locked after payment exists") : fail("amount_paid locked after payment exists", `status ${lockedEdit}`);

    const { status: nameEdit } = await api("PATCH", `/insurance/${pol.policy.id}`, { name:"E2E Policy (renamed)" });
    nameEdit===200 ? pass("editing unrelated field still works") : fail("editing unrelated field still works", `status ${nameEdit}`);

    const payload = { wallet_id: walA.id, amount_kes: 77 };
    const [r1,r2] = await Promise.all([
      api("POST", `/insurance/${pol.policy.id}/payments`, payload),
      api("POST", `/insurance/${pol.policy.id}/payments`, payload),
    ]);
    const statuses = [r1.status, r2.status].sort();
    (statuses[0]===201 && statuses[1]===409) ? pass("duplicate premium payment rejected") : fail("duplicate premium payment rejected", `statuses: ${statuses}`);
  }

  console.log("=== INVESTMENTS ===");
  {
    const { json: inv } = await api("POST","/investments",{ name:"E2E Investment", wallet_id: walA.id, type:"Stock", units:10, buy_price_kes:100, currency:"KES" });
    created.investments.push(inv.investment.id);
    const payload = { wallet_id: walA.id, return_type:"dividend", amount_kes: 200 };
    const [r1,r2] = await Promise.all([
      api("POST", `/investments/${inv.investment.id}/returns`, payload),
      api("POST", `/investments/${inv.investment.id}/returns`, payload),
    ]);
    const statuses = [r1.status, r2.status].sort();
    (statuses[0]===201 && statuses[1]===409) ? pass("duplicate investment return rejected") : fail("duplicate investment return rejected", `statuses: ${statuses}`);
  }

  console.log("=== GOALS ===");
  {
    // target_kes must be large enough that `toAdd` (min(amount, target-saved))
    // isn't clamped below the wallet's balance, otherwise an "overdraft"
    // attempt just gets silently capped to an affordable amount instead of
    // actually testing the balance check.
    const { json: goal } = await api("POST","/goals",{ name:"E2E Goal", target_kes:900000000, wallet_id: walB.id });
    created.goals.push(goal.goal.id);
    const { status: fundOk } = await api("POST", `/goals/${goal.goal.id}/fund`, { amount: 300, from_wallet_id: walA.id });
    fundOk===200 ? pass("goal funding accepted") : fail("goal funding accepted", `status ${fundOk}`);

    const { status: overFund } = await api("POST", `/goals/${goal.goal.id}/fund`, { amount: 999999999, from_wallet_id: walA.id });
    overFund===400 ? pass("goal funding overdraft rejected") : fail("goal funding overdraft rejected", `status ${overFund}`);
  }

  console.log("=== CSV IMPORT ===");
  {
    // Use walB by name — walA gets renamed earlier in this script, and the
    // CSV importer matches wallets by name string, so it must be a name
    // that's still accurate. Include a per-run nonce so re-running this
    // script doesn't collide with the previous run's file-hash dedupe
    // record (a real feature working correctly, not something to work
    // around by disabling it).
    const csv = "date,time,type,category,amount_kes,merchant,note,wallet\n"
      + `2026-08-20,10:00,refund,,150,TestShop,E2E refund row ${Date.now()},${walB.name}\n`;
    const { json: wBefore } = await api("GET","/wallets");
    const balBefore = parseFloat(wBefore.wallets.find(w=>w.id===walB.id).balance);
    const form = new FormData();
    form.append("file", new Blob([csv], {type:"text/csv"}), "e2e-import.csv");
    const res1 = await fetch(`${BASE}/transactions/import`, { method:"POST", headers:{ Authorization:`Bearer ${token}` }, body: form });
    const json1 = await res1.json();
    const { json: wAfter } = await api("GET","/wallets");
    const balAfter = parseFloat(wAfter.wallets.find(w=>w.id===walB.id).balance);
    (res1.status===200 && approx(balAfter, balBefore+150)) ? pass("CSV import: refund row credits wallet") : fail("CSV import: refund row credits wallet", `status ${res1.status} bal ${balBefore}->${balAfter} resp ${JSON.stringify(json1)}`);

    const form2 = new FormData();
    form2.append("file", new Blob([csv], {type:"text/csv"}), "e2e-import.csv");
    const res2 = await fetch(`${BASE}/transactions/import`, { method:"POST", headers:{ Authorization:`Bearer ${token}` }, body: form2 });
    res2.status===409 ? pass("CSV re-import of same file rejected") : fail("CSV re-import of same file rejected", `status ${res2.status}`);
  }

  console.log("=== WALLET DELETE ===");
  {
    const { status: blocked } = await api("DELETE", `/wallets/${walA.id}`);
    blocked===409 ? pass("delete wallet with linked records blocked") : fail("delete wallet with linked records blocked", `status ${blocked}`);
    const { status: allowed } = await api("DELETE", `/wallets/${walC.id}`);
    allowed===200 ? pass("delete empty wallet allowed") : fail("delete empty wallet allowed", `status ${allowed}`);
    created.wallets = created.wallets.filter(id=>id!==walC.id);
  }

  console.log("=== HOUSEHOLD LINKING ===");
  const householdTestUsers = [];
  {
    const nonce = Date.now();
    async function registerThrowaway(label) {
      const email = `e2e-hh-${label}-${nonce}@test.local`;
      const { status, json } = await api("POST", "/auth/register", { email, password: "TestPass123!", full_name: `E2E ${label}` }, { token: null });
      if (status !== 201) return { ok:false, status, json };
      householdTestUsers.push({ email, token: json.accessToken });
      return { ok:true, token: json.accessToken, id: json.user.id };
    }

    const a = await registerThrowaway("A");
    const b = await registerThrowaway("B");
    (a.ok && b.ok) ? pass("register two throwaway household test users") : fail("register two throwaway household test users", JSON.stringify([a,b]));

    // A creates a wallet + transaction as a baseline to prove sharing.
    const { json: walJson } = await api("POST", "/wallets", { name:"E2E HH Wallet", balance:5000 }, { token: a.token });
    const hhWalletId = walJson?.wallet?.id;
    await api("POST", "/transactions", { wallet_id: hhWalletId, type:"expense", amount_kes: 100 }, { token: a.token });

    const { status: invStatus, json: invJson } = await api("POST", "/household/invite", null, { token: a.token });
    const code = invJson?.code;
    (invStatus===200 && code) ? pass("A generates an invite code") : fail("A generates an invite code", `status ${invStatus} ${JSON.stringify(invJson)}`);

    const { status: acceptStatus } = await api("POST", "/household/accept", { code }, { token: b.token });
    acceptStatus===200 ? pass("B accepts A's invite") : fail("B accepts A's invite", `status ${acceptStatus}`);

    const { json: bWallets } = await api("GET", "/wallets", null, { token: b.token });
    (bWallets?.wallets||[]).some(w=>w.id===hhWalletId)
      ? pass("B immediately sees A's wallet") : fail("B immediately sees A's wallet", JSON.stringify(bWallets));

    const { status: bTxStatus } = await api("POST", "/transactions", { wallet_id: hhWalletId, type:"expense", amount_kes: 250 }, { token: b.token });
    const { json: aTxs } = await api("GET", "/transactions", null, { token: a.token });
    (bTxStatus===201 && (aTxs?.transactions||[]).some(t=>parseFloat(t.amount_kes)===250))
      ? pass("bidirectional: B's transaction visible to A") : fail("bidirectional: B's transaction visible to A", `status ${bTxStatus}`);

    // C has real data — must be rejected joining a (different, otherwise
    // empty) household.
    const c = await registerThrowaway("C");
    await api("POST", "/wallets", { name:"E2E HH Wallet C", balance:100 }, { token: c.token });
    // C becomes the owner of a second, fresh (otherwise-empty) household —
    // used below to prove "existing data blocks join" holds even when the
    // target household itself has room and no other issue.
    const { json: cInvJson } = await api("POST", "/household/invite", null, { token: c.token });

    const dRejectDirty = await registerThrowaway("D");
    await api("POST", "/wallets", { name:"E2E HH Wallet D", balance:50 }, { token: dRejectDirty.token }); // give D real data
    const { status: freshInvStatus, json: freshInvJson } = await api("POST", "/household/invite", null, { token: a.token }); // A's household is full (A+B) -> should reject
    (freshInvStatus===409) ? pass("full household rejects a new invite") : fail("full household rejects a new invite", `status ${freshInvStatus} ${JSON.stringify(freshInvJson)}`);

    // A dirty (non-empty) account cannot join even a fresh, empty household.
    const { status: dirtyJoinStatus } = await api("POST", "/household/accept", { code: cInvJson?.code }, { token: dRejectDirty.token });
    dirtyJoinStatus===400 ? pass("account with existing data rejected from joining") : fail("account with existing data rejected from joining", `status ${dirtyJoinStatus}`);

    const { status: leaveStatus } = await api("POST", "/household/leave", null, { token: b.token });
    const { json: bWalletsAfterLeave } = await api("GET", "/wallets", null, { token: b.token });
    (leaveStatus===200 && (bWalletsAfterLeave?.wallets||[]).length===0)
      ? pass("leave is airtight — B sees nothing after leaving") : fail("leave is airtight — B sees nothing after leaving", `status ${leaveStatus} wallets=${JSON.stringify(bWalletsAfterLeave)}`);

    // Cleanup: A's baseline wallet (also removes B's transaction on it via
    // the same cascade path normal wallet cleanup uses), then best-effort
    // deactivate every throwaway account (no hard-delete endpoint exists).
    if (hhWalletId) {
      const { json: hhTxs } = await api("GET", `/transactions?wallet_id=${hhWalletId}&limit=1000`, null, { token: a.token });
      for (const t of (hhTxs?.transactions||[])) await api("DELETE", `/transactions/${t.id}`, null, { token: a.token }).catch(()=>{});
      await api("DELETE", `/wallets/${hhWalletId}`, null, { token: a.token }).catch(()=>{});
    }
    for (const u of householdTestUsers) await api("DELETE", "/auth/account", null, { token: u.token }).catch(()=>{});
  }

  console.log("\n=== SUMMARY ===");
  const failed = results.filter(r=>!r.ok);
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log("FAILURES:"); failed.forEach(f=>console.log(`  - ${f.name}: ${f.detail}`)); }

  console.log("\n=== CLEANUP ===");
  for (const id of created.goals) await api("DELETE", `/goals/${id}`);
  for (const id of created.investments) await api("DELETE", `/investments/${id}`);
  for (const id of created.policies) await api("DELETE", `/insurance/${id}`);
  for (const id of created.loans) await api("DELETE", `/loans/${id}`);
  for (const id of created.categories) await api("DELETE", `/categories/${id}`).catch(()=>{});
  // Sweep every transaction on the wallets we created, by wallet_id, not
  // just the ones we individually tracked — a CSV import creates a row
  // with no id returned to track, and a leftover one blocks the wallet
  // delete just below.
  for (const wid of created.wallets) {
    if (!wid) continue;
    const { json } = await api("GET", `/transactions?wallet_id=${wid}&limit=1000`);
    for (const t of (json?.transactions||[])) await api("DELETE", `/transactions/${t.id}`).catch(()=>{});
  }
  for (const id of created.wallets) if(id) {
    const { status } = await api("DELETE", `/wallets/${id}`);
    if (status !== 200) console.log(`  warning: wallet ${id} cleanup left it undeleted (status ${status})`);
  }
  console.log("Cleanup attempted for all created test resources.");

  process.exit(failed.length ? 1 : 0);
}

run().catch(e => { console.error("Test run crashed:", e); process.exit(1); });
