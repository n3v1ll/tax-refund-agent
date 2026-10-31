import { useEffect, useMemo, useState } from 'react';
import { computeReturn, brokerName, type EngineOptions, type Figure, type Issue, type ReturnResult } from '../src/engine/compute';
import { mergeFx, parseRbaF11Csv, type FxTable } from '../src/engine/fx';
import { loadFile } from '../src/io/load';
import { emptyLedger, mergeLedgers, type AssetClass, type Ledger, type Trade } from '../src/model';
import { LABELS, labelDef, type LabelCode } from '../src/rules/labels';
import { RULES, TAX_YEARS, taxYearParams, type RuleId } from '../src/rules/rules';
import { BROKER_NAMES, documentRequests, type BrokerKey } from '../src/rules/documents';
import { GENERIC_INCOME_TEMPLATE, GENERIC_TRADE_TEMPLATE } from '../src/parsers/trades';

interface LoadedFile {
  name: string;
  detected: string;
  ledger: Ledger;
}

const SAMPLES = ['etoro-account-statement-sample.xlsx', 'cmc-invest-trades-sample.csv', 'stockspot-annual-tax-statement-sample.pdf'];
const RBA_CSV_URL = 'https://www.rba.gov.au/statistics/tables/csv/f11.1-data.csv';

export function App() {
  const [taxYear, setTaxYear] = useState(2026);
  const [brokers, setBrokers] = useState<BrokerKey[]>(['etoro', 'cmc-invest', 'stockspot']);
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [manualTrades, setManualTrades] = useState<Trade[]>([]);
  const [fx, setFx] = useState<FxTable | null>(null);
  const [fxNote, setFxNote] = useState('Loading exchange rates...');
  const [demo, setDemo] = useState(false);
  const [opts, setOpts] = useState<EngineOptions>({ parcelMethod: 'fifo', priorYearLosses: 0, classificationOverrides: {}, excludedIds: [] });
  const [confirmed, setConfirmed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('./fx/rba-f11.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((t: FxTable) => { setFx(t); setFxNote(`RBA rates loaded (${t.source}).`); })
      .catch(() => setFxNote('No exchange rates bundled yet. Upload the RBA F11.1 CSV below.'));
  }, []);

  const ledger = useMemo(() => {
    const manual = { ...emptyLedger(), trades: manualTrades };
    return mergeLedgers(...files.map((f) => f.ledger), manual);
  }, [files, manualTrades]);

  const result: ReturnResult | null = useMemo(() => {
    if (files.length === 0 && manualTrades.length === 0) return null;
    return computeReturn(ledger, taxYear, fx ?? { rates: {}, source: 'none' }, opts);
  }, [ledger, taxYear, fx, opts, files.length, manualTrades.length]);

  // A confirmation only counts for the exact value that was confirmed.
  const isConfirmed = (f: Figure) => confirmed[f.code] === String(f.value);

  async function addFiles(list: FileList | File[]) {
    setBusy(true);
    const next: LoadedFile[] = [];
    for (const file of Array.from(list)) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (/f11/i.test(file.name) && file.name.toLowerCase().endsWith('.csv')) {
          const t = parseRbaF11Csv(new TextDecoder().decode(bytes), `RBA F11.1 (${file.name})`);
          setFx((prev) => (prev && !demo ? mergeFx(prev, t) : t));
          setDemo(false);
          setFxNote(`RBA rates loaded from ${file.name}.`);
          continue;
        }
        const r = await loadFile(file.name, bytes);
        next.push({ name: file.name, detected: r.detected, ledger: r.ledger });
      } catch (e) {
        const l = emptyLedger();
        l.warnings.push({ file: file.name, message: `Could not read this file: ${(e as Error).message}` });
        next.push({ name: file.name, detected: 'error', ledger: l });
      }
    }
    setFiles((prev) => [...prev.filter((p) => !next.some((n) => n.name === p.name)), ...next]);
    setBusy(false);
  }

  async function loadSamples() {
    const fs = await Promise.all(SAMPLES.map(async (n) => new File([await (await fetch(`./samples/${n}`)).arrayBuffer()], n)));
    if (!fx) { setFx(demoFx()); setDemo(true); setFxNote('Using made-up demo exchange rates (A$1 = US$0.65 every day). Load real RBA rates before using real statements.'); }
    await addFiles(fs);
  }

  const year = taxYearParams(taxYear);
  const docs = documentRequests(brokers, year);
  const confirmable = result ? result.figures.filter((f) => isRelevant(f)) : [];
  const done = confirmable.filter(isConfirmed).length;

  return (
    <div className="page">
      <header className="top">
        <h1>Tax Refund Agent</h1>
        <p className="tag">Turns your broker statements into the figures myTax asks for. You check each one and type it into myTax yourself.</p>
        <p className="notice">This is a calculator, not tax advice. It applies the same published rules to everyone, never sees your TFN, and never lodges anything. Your files are read in this browser tab and are not uploaded anywhere.</p>
      </header>

      <section className="card">
        <h2>1. About you</h2>
        <div className="row">
          <label>Income year&nbsp;
            <select value={taxYear} onChange={(e) => setTaxYear(Number(e.target.value))}>
              {Object.values(TAX_YEARS).map((y) => <option key={y.year} value={y.year}>{y.year - 1}-{String(y.year).slice(2)} (1 Jul {y.year - 1} to 30 Jun {y.year})</option>)}
            </select>
          </label>
        </div>
        <fieldset className="row">
          <legend>Which brokers did you use?</legend>
          {(Object.keys(BROKER_NAMES) as BrokerKey[]).map((b) => (
            <label key={b} className="check">
              <input type="checkbox" checked={brokers.includes(b)} onChange={(e) => setBrokers(e.target.checked ? [...brokers, b] : brokers.filter((x) => x !== b))} /> {BROKER_NAMES[b]}
            </label>
          ))}
        </fieldset>
        <div className="row">
          <label>Unused capital losses from last year (label 18V on last year's return)&nbsp;
            <input type="number" min={0} step="1" value={opts.priorYearLosses || ''} placeholder="0" onChange={(e) => setOpts({ ...opts, priorYearLosses: Number(e.target.value) || 0 })} />
          </label>
        </div>
        <p className="small">You are in scope if you are an Australian resident for tax, invest in shares, ETFs or CFDs, and are not running a share trading business. Crypto, property and trader status are not covered.</p>
      </section>

      <section className="card">
        <h2>2. Documents to download</h2>
        <ol className="docs">
          {docs.map((d) => {
            const ok = d.satisfiedBy(ledger);
            return (
              <li key={d.id} className={ok ? 'ok' : ''}>
                <strong>{ok ? '✓ ' : ''}{d.title}</strong> {!d.required && <span className="pill">if you have it</span>}
                <div className="small">{d.why}</div>
                <div className="small"><em>Where:</em> {d.where} <em>Format:</em> {d.format}.</div>
              </li>
            );
          })}
        </ol>
        <p className="small">
          Using another broker? Fill in our <a href={dataUrl(GENERIC_TRADE_TEMPLATE)} download="trades-template.csv">trades template</a> or <a href={dataUrl(GENERIC_INCOME_TEMPLATE)} download="income-template.csv">income template</a>.
        </p>
      </section>

      <section className="card">
        <h2>3. Add your files</h2>
        <div
          className="drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void addFiles(e.dataTransfer.files); }}
        >
          <p>Drop statements here, or <label className="link">choose files<input type="file" multiple hidden accept=".xlsx,.csv,.pdf" onChange={(e) => e.target.files && void addFiles(e.target.files)} /></label>.</p>
          <p className="small">No statements handy? <button className="linkbtn" onClick={() => void loadSamples()}>Try made-up sample statements</button>.</p>
          {busy && <p>Reading...</p>}
        </div>
        {files.length > 0 && (
          <table className="files">
            <thead><tr><th>File</th><th>Read as</th><th>Found</th><th></th></tr></thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.name}>
                  <td>{f.name}</td>
                  <td>{f.detected}</td>
                  <td className="small">{summarise(f.ledger)}</td>
                  <td><button className="linkbtn" onClick={() => setFiles(files.filter((x) => x !== f))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className={`fx ${demo ? 'warn' : ''}`}>
          <strong>Exchange rates:</strong> {fxNote}{' '}
          <span className="small">Real rates: download <a href={RBA_CSV_URL} target="_blank" rel="noreferrer">RBA table F11.1 (CSV)</a> and drop it in with your statements.</span>
        </div>
      </section>

      {result && (
        <>
          <Issues result={result} onAddTrade={(t) => setManualTrades([...manualTrades, t])} />
          <Review result={result} opts={opts} setOpts={setOpts} />
          <section className="card">
            <h2>6. Your myTax figures</h2>
            <p className="small">Same order as myTax. Open "Why this number" to see every trade behind a figure and the rule used. Tick each figure once you have checked it; the copy button unlocks after you confirm. {done} of {confirmable.length} confirmed.</p>
            {groupBySection(result.figures).map(([section, figs]) => (
              <div key={section} className="section">
                <h3>{section}</h3>
                {figs.map((f) => (
                  <FigureRow key={f.code} f={f} result={result} confirmed={isConfirmed(f)} onConfirm={(c) => setConfirmed({ ...confirmed, [f.code]: c ? String(f.value) : '' })} />
                ))}
              </div>
            ))}
            <div className="actions">
              <button onClick={() => window.print()} disabled={done < confirmable.length}>Save workpaper (print to PDF)</button>
              {done < confirmable.length && <span className="small"> Confirm every figure first.</span>}
            </div>
            <p className="small">Keep the workpaper with your statements for five years, as the ATO requires.</p>
          </section>
          <Workpaper result={result} files={files} />
        </>
      )}

      <RulesList />
    </div>
  );
}

function isRelevant(f: Figure): boolean {
  return f.code === '18G' || f.value !== 0 || f.lines.length > 0;
}

function FigureRow({ f, result, confirmed, onConfirm }: { f: Figure; result: ReturnResult; confirmed: boolean; onConfirm: (c: boolean) => void }) {
  const def = labelDef(f.code)!;
  const [open, setOpen] = useState(false);
  const blocked = f.blockedBy.length > 0;
  const shown = formatValue(f);
  const relevant = isRelevant(f);
  return (
    <div className={`fig ${relevant ? '' : 'empty'} ${blocked ? 'blocked' : ''}`}>
      <div className="fighead">
        <span className="code">{f.code}</span>
        <span className="title">{def.title}</span>
        <span className="value">{shown}</span>
        {relevant && (
          <>
            <label className="check confirm" title={blocked ? 'Resolve the issues above first' : ''}>
              <input type="checkbox" disabled={blocked} checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} /> I've checked this
            </label>
            <button disabled={!confirmed} onClick={() => void navigator.clipboard.writeText(copyText(f))}>Copy</button>
          </>
        )}
      </div>
      {blocked && <div className="small blockmsg">Waiting on: {f.blockedBy.map((id) => result.issues.find((i) => i.id === id)?.message).join(' ')}</div>}
      {relevant && <button className="linkbtn" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Why this number'}</button>}
      {open && (
        <div className="why">
          <ul>
            {f.lines.map((l, i) => (
              <li key={i}>
                <span>{l.description}</span>
                <span className="amt">{money(l.amount)}</span>
                {l.source && <span className="src">{l.source.file}, {l.source.locator}</span>}
              </li>
            ))}
            {f.lines.length === 0 && <li>Nothing found for this label.</li>}
          </ul>
          <p className="small">Rules: {f.ruleIds.map((r) => <RuleLink key={r} id={r} />)}</p>
          {def.format === 'dollars' && <p className="small">myTax asks for whole dollars here, so cents are dropped.</p>}
        </div>
      )}
    </div>
  );
}

function Issues({ result, onAddTrade }: { result: ReturnResult; onAddTrade: (t: Trade) => void }) {
  const groups: [string, Issue['severity'], string][] = [
    ['Needed before we can finish', 'blocker', 'blocker'],
    ['Outside what this tool handles', 'out_of_scope', 'scope'],
    ['Worth checking', 'warning', 'warning'],
  ];
  return (
    <section className="card">
      <h2>4. What we still need</h2>
      {result.issues.length === 0 && <p>Nothing. Every document we need is here.</p>}
      {groups.map(([title, sev, cls]) => {
        const is = result.issues.filter((i) => i.severity === sev);
        if (!is.length) return null;
        return (
          <div key={sev} className={`issues ${cls}`}>
            <h3>{title}</h3>
            <ul>
              {is.map((i) => (
                <li key={i.id}>
                  {i.message} {i.ask && <strong>{i.ask}</strong>}
                  {i.code === 'MISSING_COST_BASE' && <ManualBuy issue={i} result={result} onAdd={onAddTrade} />}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function ManualBuy({ issue, result, onAdd }: { issue: Issue; result: ReturnResult; onAdd: (t: Trade) => void }) {
  const d = result.disposals.find((x) => issue.id.endsWith(x.id.split('#')[0]!));
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [units, setUnits] = useState(String(d?.unmatchedUnits ?? ''));
  const [price, setPrice] = useState('');
  const [fees, setFees] = useState('0');
  const [ccy, setCcy] = useState('AUD');
  if (!d) return null;
  if (!open) return <div><button className="linkbtn" onClick={() => setOpen(true)}>Type in the purchase instead</button></div>;
  return (
    <form className="manual" onSubmit={(e) => {
      e.preventDefault();
      if (!date || !Number(units) || !Number(price)) return;
      onAdd({ id: `manual:${d.symbol}:${date}:${units}:${Date.now()}`, broker: d.broker as Trade['broker'], date, side: 'buy', symbol: d.symbol, units: Number(units), price: Number(price), fees: Number(fees) || 0, currency: ccy, assetClass: 'share', source: { broker: 'manual', file: 'Typed in by you', locator: `${d.symbol} bought ${date}` } });
      setOpen(false);
    }}>
      <span>Bought {d.symbol} on</span> <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      <input type="number" step="any" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="units" aria-label="units" />
      <span>units at</span> <input type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="price" aria-label="price" />
      <select value={ccy} onChange={(e) => setCcy(e.target.value)}><option>AUD</option><option>USD</option></select>
      <span>brokerage</span> <input type="number" step="any" value={fees} onChange={(e) => setFees(e.target.value)} aria-label="brokerage" />
      <button type="submit">Add</button>
      <div className="small">Keep the contract note: the ATO can ask for proof of the purchase.</div>
    </form>
  );
}

function Review({ result, opts, setOpts }: { result: ReturnResult; opts: EngineOptions; setOpts: (o: EngineOptions) => void }) {
  return (
    <section className="card">
      <h2>5. Check how we treated each item</h2>
      <div className="row">
        <span>When you sold part of a holding, which purchase was sold?&nbsp;</span>
        <label className="check"><input type="radio" checked={opts.parcelMethod === 'fifo'} onChange={() => setOpts({ ...opts, parcelMethod: 'fifo' })} /> Oldest first (FIFO)</label>
        <label className="check"><input type="radio" checked={opts.parcelMethod === 'lowest_tax'} onChange={() => setOpts({ ...opts, parcelMethod: 'lowest_tax' })} /> The parcels I chose to sell (lowest tax)</label>
        <div className="small"><RuleLink id="CGT_PARCEL_FIFO" /> <RuleLink id="CGT_PARCEL_SPECIFIC" /></div>
      </div>
      {result.classifications.length > 0 && (
        <details>
          <summary>eToro positions: real share or CFD ({result.classifications.length})</summary>
          <table>
            <thead><tr><th>Position</th><th>eToro type</th><th>Why</th><th>Treated as</th></tr></thead>
            <tbody>
              {result.classifications.map((c) => (
                <tr key={c.positionId}>
                  <td>{c.symbol}</td>
                  <td>{c.brokerType}</td>
                  <td className="small">{c.reason}</td>
                  <td>
                    <select value={c.assetClass} onChange={(e) => setOpts({ ...opts, classificationOverrides: { ...opts.classificationOverrides, [c.positionId]: e.target.value as AssetClass } })}>
                      <option value="share">Real share (capital gains)</option>
                      <option value="etf">ETF (capital gains)</option>
                      <option value="cfd">CFD (other income)</option>
                      <option value="crypto">Crypto (not covered)</option>
                      {c.assetClass === 'unknown' && <option value="unknown">Not sure</option>}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {result.disposals.length > 0 && (
        <details>
          <summary>Sales and the purchases matched to them ({result.disposals.length})</summary>
          <table>
            <thead><tr><th>Sold</th><th>Units</th><th>Bought</th><th>Proceeds</th><th>Cost</th><th>Gain</th><th>Discount</th><th></th></tr></thead>
            <tbody>
              {result.disposals.map((d) => (
                <tr key={d.id} className={opts.excludedIds.includes(d.id) ? 'struck' : ''}>
                  <td>{d.symbol} {d.date}<div className="small">{brokerName(d.broker)}</div></td>
                  <td>{round(d.units)}</td>
                  <td>{d.parcels.map((p) => p.acquired).join(', ') || '—'}</td>
                  <td>{money(d.proceedsAud)}</td>
                  <td>{money(d.costAud)}</td>
                  <td>{money(d.gainAud)}</td>
                  <td>{d.discountEligible ? 'Yes' : 'No'}</td>
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

function Workpaper({ result, files }: { result: ReturnResult; files: LoadedFile[] }) {
  return (
    <section className="workpaper">
      <h1>Investment income workpaper {result.taxYear - 1}-{String(result.taxYear).slice(2)}</h1>
      <p>Prepared {new Date().toLocaleDateString('en-AU')} with Tax Refund Agent (a calculator, not tax advice). Figures were checked and entered into myTax by the taxpayer.</p>
      <h2>Documents</h2>
      <ul>{files.map((f) => <li key={f.name}>{f.name}: {f.detected}</li>)}</ul>
      <h2>Figures</h2>
      {result.figures.filter(isRelevant).map((f) => (
        <div key={f.code}>
          <h3>{f.code} {labelDef(f.code)!.title}: {formatValue(f)}</h3>
          <ul>{f.lines.map((l, i) => <li key={i}>{l.description}: {money(l.amount)}{l.source ? ` (${l.source.file}, ${l.source.locator})` : ''}</li>)}</ul>
          <p>Rules: {f.ruleIds.map((r) => RULES[r].title).join('; ')}</p>
        </div>
      ))}
      <h2>Open items</h2>
      <ul>{result.issues.map((i) => <li key={i.id}>{i.message}</li>)}</ul>
    </section>
  );
}

function RulesList() {
  return (
    <section className="card">
      <details>
        <summary>The rules this tool uses</summary>
        <p className="small">Every figure comes from these fixed rules, applied the same way for everyone. No AI decides how anything is taxed. Links marked "to verify" have not yet been checked against the current ATO page.</p>
        <dl className="rules">
          {Object.values(RULES).map((r) => (
            <div key={r.id} id={`rule-${r.id}`}>
              <dt>{r.title}</dt>
              <dd>{r.statement} <a href={r.citation.url} target="_blank" rel="noreferrer">{r.citation.label}</a>{!r.verified && <span className="pill">to verify</span>}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}

function RuleLink({ id }: { id: RuleId }) {
  return <a className="rulelink" href={`#rule-${id}`}>{RULES[id].title}</a>;
}

function groupBySection(figs: Figure[]): [string, Figure[]][] {
  const out: [string, Figure[]][] = [];
  for (const l of LABELS) {
    const f = figs.find((x) => x.code === l.code)!;
    const last = out[out.length - 1];
    if (last && last[0] === l.section) last[1].push(f);
    else out.push([l.section, [f]]);
  }
  return out;
}

function formatValue(f: Figure): string {
  const def = labelDef(f.code as LabelCode)!;
  if (def.format === 'yesno') return f.value ? 'Yes' : 'No';
  const n = f.value as number;
  if (def.format === 'dollars') return '$' + Math.trunc(n).toLocaleString('en-AU');
  return money(n);
}

function copyText(f: Figure): string {
  const def = labelDef(f.code as LabelCode)!;
  if (def.format === 'yesno') return f.value ? 'Yes' : 'No';
  const n = f.value as number;
  return def.format === 'dollars' ? String(Math.trunc(n)) : n.toFixed(2);
}

function money(n: number): string {
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function round(n: number) {
  return Math.round(n * 10000) / 10000;
}

function summarise(l: Ledger): string {
  const parts: string[] = [];
  if (l.closedPositions.length) parts.push(`${l.closedPositions.length} closed positions`);
  if (l.trades.length) parts.push(`${l.trades.length} trades`);
  if (l.income.length) parts.push(`${l.income.length} income payments`);
  if (l.reported.length || l.reportedCapitalGains.length) parts.push(`${l.reported.length + l.reportedCapitalGains.length} reported figures`);
  if (l.warnings.length) parts.push(`${l.warnings.length} warning(s)`);
  return parts.join(', ') || 'nothing usable';
}

function dataUrl(csv: string) {
  return 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
}

function demoFx(): FxTable {
  const usd: Record<string, number> = {};
  for (let t = Date.parse('2023-01-01'); t <= Date.parse('2026-12-31'); t += 86400000) usd[new Date(t).toISOString().slice(0, 10)] = 0.65;
  return { rates: { USD: usd }, source: 'demo' };
}
