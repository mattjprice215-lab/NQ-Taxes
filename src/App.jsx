"use client";

import React, { useMemo, useState } from "react";

type FilingStatus = "single" | "married_joint" | "married_separate" | "head_household";

type TaxBrackets = {
  ordinary: { limit: number; rate: number }[];
  ltcg: { limit: number; rate: number }[];
  niitThreshold: number;
  standardDeduction: number;
};

const TAX_YEAR = 2026;

const TAX_DATA: Record<FilingStatus, TaxBrackets> = {
  single: {
    ordinary: [
      { limit: 11925, rate: 0.10 },
      { limit: 48475, rate: 0.12 },
      { limit: 103350, rate: 0.22 },
      { limit: 197300, rate: 0.24 },
      { limit: 250525, rate: 0.32 },
      { limit: 626350, rate: 0.35 },
      { limit: Infinity, rate: 0.37 },
    ],
    ltcg: [
      { limit: 48350, rate: 0.00 },
      { limit: 533400, rate: 0.15 },
      { limit: Infinity, rate: 0.20 },
    ],
    niitThreshold: 200000,
    standardDeduction: 15000,
  },
  married_joint: {
    ordinary: [
      { limit: 23850, rate: 0.10 },
      { limit: 96950, rate: 0.12 },
      { limit: 206700, rate: 0.22 },
      { limit: 394600, rate: 0.24 },
      { limit: 501050, rate: 0.32 },
      { limit: 751600, rate: 0.35 },
      { limit: Infinity, rate: 0.37 },
    ],
    ltcg: [
      { limit: 96700, rate: 0.00 },
      { limit: 600050, rate: 0.15 },
      { limit: Infinity, rate: 0.20 },
    ],
    niitThreshold: 250000,
    standardDeduction: 30000,
  },
  married_separate: {
    ordinary: [
      { limit: 11925, rate: 0.10 },
      { limit: 48475, rate: 0.12 },
      { limit: 103350, rate: 0.22 },
      { limit: 197300, rate: 0.24 },
      { limit: 250525, rate: 0.32 },
      { limit: 375800, rate: 0.35 },
      { limit: Infinity, rate: 0.37 },
    ],
    ltcg: [
      { limit: 48350, rate: 0.00 },
      { limit: 300000, rate: 0.15 },
      { limit: Infinity, rate: 0.20 },
    ],
    niitThreshold: 125000,
    standardDeduction: 15000,
  },
  head_household: {
    ordinary: [
      { limit: 17000, rate: 0.10 },
      { limit: 64850, rate: 0.12 },
      { limit: 103350, rate: 0.22 },
      { limit: 197300, rate: 0.24 },
      { limit: 250500, rate: 0.32 },
      { limit: 626350, rate: 0.35 },
      { limit: Infinity, rate: 0.37 },
    ],
    ltcg: [
      { limit: 64750, rate: 0.00 },
      { limit: 566700, rate: 0.15 },
      { limit: Infinity, rate: 0.20 },
    ],
    niitThreshold: 200000,
    standardDeduction: 22500,
  },
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function clampNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function taxFromBrackets(income: number, brackets: { limit: number; rate: number }[]) {
  let remaining = Math.max(0, income);
  let prevLimit = 0;
  let tax = 0;

  for (const bracket of brackets) {
    const taxableAtThisRate = Math.min(remaining, bracket.limit - prevLimit);
    if (taxableAtThisRate <= 0) break;
    tax += taxableAtThisRate * bracket.rate;
    remaining -= taxableAtThisRate;
    prevLimit = bracket.limit;
  }

  return tax;
}

function capitalGainTaxUsingStacking(
  taxableOrdinaryIncome: number,
  netLongTermGain: number,
  ltcgBrackets: { limit: number; rate: number }[]
) {
  let remainingGain = Math.max(0, netLongTermGain);
  let tax = 0;
  let lowerBound = 0;
  let occupied = Math.max(0, taxableOrdinaryIncome);

  for (const bracket of ltcgBrackets) {
    const bracketWidth = bracket.limit - lowerBound;
    const availableRoom = Math.max(0, bracketWidth - Math.max(0, occupied - lowerBound));
    const taxedHere = Math.min(remainingGain, availableRoom);

    if (taxedHere > 0) {
      tax += taxedHere * bracket.rate;
      remainingGain -= taxedHere;
      occupied += taxedHere;
    }

    lowerBound = bracket.limit;
    if (remainingGain <= 0) break;
  }

  if (remainingGain > 0) {
    const topRate = ltcgBrackets[ltcgBrackets.length - 1].rate;
    tax += remainingGain * topRate;
  }

  return tax;
}

export default function Page() {
  const [filingStatus, setFilingStatus] = useState<FilingStatus>("married_joint");

  const [ordinaryIncome, setOrdinaryIncome] = useState(120000);
  const [qualifiedDividends, setQualifiedDividends] = useState(0);
  const [otherNetInvestmentIncome, setOtherNetInvestmentIncome] = useState(0);
  const [useStandardDeduction, setUseStandardDeduction] = useState(true);
  const [itemizedDeductions, setItemizedDeductions] = useState(0);

  const [saleProceeds, setSaleProceeds] = useState(50000);
  const [costBasis, setCostBasis] = useState(30000);
  const [sellingFees, setSellingFees] = useState(0);

  const [holdingPeriodLongTerm, setHoldingPeriodLongTerm] = useState(true);
  const [capitalLossCarryforward, setCapitalLossCarryforward] = useState(0);

  const [stateTaxRate, setStateTaxRate] = useState(0);
  const [includeNIIT, setIncludeNIIT] = useState(true);

  const data = TAX_DATA[filingStatus];
  const deductionUsed = useStandardDeduction
    ? data.standardDeduction
    : Math.max(0, itemizedDeductions);

  const results = useMemo(() => {
    const netSaleGain = clampNumber(saleProceeds - costBasis - sellingFees);

    const grossShortTermGain = holdingPeriodLongTerm ? 0 : Math.max(0, netSaleGain);
    const grossLongTermGain = holdingPeriodLongTerm ? Math.max(0, netSaleGain) : 0;

    const totalCapitalGainsBeforeLosses = grossShortTermGain + grossLongTermGain;

    let remainingLossCarryforward = Math.max(0, capitalLossCarryforward);
    let netShortTermGain = grossShortTermGain;
    let netLongTermGain = grossLongTermGain;

    if (remainingLossCarryforward > 0 && netShortTermGain > 0) {
      const used = Math.min(remainingLossCarryforward, netShortTermGain);
      netShortTermGain -= used;
      remainingLossCarryforward -= used;
    }

    if (remainingLossCarryforward > 0 && netLongTermGain > 0) {
      const used = Math.min(remainingLossCarryforward, netLongTermGain);
      netLongTermGain -= used;
      remainingLossCarryforward -= used;
    }

    const ordinaryIncomeBase = Math.max(0, ordinaryIncome + netShortTermGain);
    const taxableOrdinaryIncome = Math.max(0, ordinaryIncomeBase - deductionUsed);

    const longTermIncomeForPreferentialRates = Math.max(0, netLongTermGain + qualifiedDividends);

    const federalOrdinaryTax = taxFromBrackets(taxableOrdinaryIncome, data.ordinary);
    const federalLTCGTax = capitalGainTaxUsingStacking(
      taxableOrdinaryIncome,
      longTermIncomeForPreferentialRates,
      data.ltcg
    );

    const modifiedAGI =
      Math.max(0, ordinaryIncome + netShortTermGain + netLongTermGain + qualifiedDividends);

    const netInvestmentIncome =
      Math.max(0, netShortTermGain + netLongTermGain + qualifiedDividends + otherNetInvestmentIncome);

    const niitBase = Math.min(
      netInvestmentIncome,
      Math.max(0, modifiedAGI - data.niitThreshold)
    );

    const niitTax = includeNIIT ? niitBase * 0.038 : 0;

    const stateTaxableGain = Math.max(0, netShortTermGain + netLongTermGain);
    const estimatedStateTax = stateTaxableGain * (stateTaxRate / 100);

    const totalFederalTax = federalOrdinaryTax + federalLTCGTax + niitTax;
    const totalEstimatedTax = totalFederalTax + estimatedStateTax;

    const afterTaxCashFromSale = saleProceeds - sellingFees - totalEstimatedTax;

    const effectiveTaxRateOnGain =
      netSaleGain > 0 ? totalEstimatedTax / netSaleGain : 0;

    return {
      netSaleGain,
      grossShortTermGain,
      grossLongTermGain,
      netShortTermGain,
      netLongTermGain,
      deductionUsed,
      taxableOrdinaryIncome,
      longTermIncomeForPreferentialRates,
      federalOrdinaryTax,
      federalLTCGTax,
      niitTax,
      estimatedStateTax,
      totalFederalTax,
      totalEstimatedTax,
      afterTaxCashFromSale,
      modifiedAGI,
      netInvestmentIncome,
      niitBase,
      effectiveTaxRateOnGain,
      remainingLossCarryforward,
      totalCapitalGainsBeforeLosses,
    };
  }, [
    filingStatus,
    ordinaryIncome,
    qualifiedDividends,
    otherNetInvestmentIncome,
    useStandardDeduction,
    itemizedDeductions,
    saleProceeds,
    costBasis,
    sellingFees,
    holdingPeriodLongTerm,
    capitalLossCarryforward,
    stateTaxRate,
    includeNIIT,
    data,
    deductionUsed,
  ]);

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.title}>Taxable Stock Sale Tax Estimator</h1>
        <p style={styles.subtitle}>
          Estimate taxes from selling stocks in a non-retirement brokerage account.
        </p>

        <div style={styles.grid}>
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Taxpayer Inputs</h2>

            <label style={styles.label}>
              Filing Status
              <select
                style={styles.input}
                value={filingStatus}
                onChange={(e) => setFilingStatus(e.target.value as FilingStatus)}
              >
                <option value="single">Single</option>
                <option value="married_joint">Married Filing Jointly</option>
                <option value="married_separate">Married Filing Separately</option>
                <option value="head_household">Head of Household</option>
              </select>
            </label>

            <label style={styles.label}>
              Ordinary Taxable Income Before This Sale
              <input
                style={styles.input}
                type="number"
                value={ordinaryIncome}
                onChange={(e) => setOrdinaryIncome(Number(e.target.value))}
              />
            </label>

            <label style={styles.label}>
              Qualified Dividends
              <input
                style={styles.input}
                type="number"
                value={qualifiedDividends}
                onChange={(e) => setQualifiedDividends(Number(e.target.value))}
              />
            </label>

            <label style={styles.label}>
              Other Net Investment Income
              <input
                style={styles.input}
                type="number"
                value={otherNetInvestmentIncome}
                onChange={(e) => setOtherNetInvestmentIncome(Number(e.target.value))}
              />
            </label>

            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={useStandardDeduction}
                onChange={(e) => setUseStandardDeduction(e.target.checked)}
              />
              Use Standard Deduction ({formatCurrency(data.standardDeduction)})
            </label>

            {!useStandardDeduction && (
              <label style={styles.label}>
                Itemized Deductions
                <input
                  style={styles.input}
                  type="number"
                  value={itemizedDeductions}
                  onChange={(e) => setItemizedDeductions(Number(e.target.value))}
                />
              </label>
            )}

            <label style={styles.label}>
              State Tax Rate on Capital Gains (%)
              <input
                style={styles.input}
                type="number"
                step="0.01"
                value={stateTaxRate}
                onChange={(e) => setStateTaxRate(Number(e.target.value))}
              />
            </label>

            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={includeNIIT}
                onChange={(e) => setIncludeNIIT(e.target.checked)}
              />
              Include Net Investment Income Tax (3.8%)
            </label>
          </section>

          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Stock Sale Inputs</h2>

            <label style={styles.label}>
              Sale Proceeds
              <input
                style={styles.input}
                type="number"
                value={saleProceeds}
                onChange={(e) => setSaleProceeds(Number(e.target.value))}
              />
            </label>

            <label style={styles.label}>
              Cost Basis
              <input
                style={styles.input}
                type="number"
                value={costBasis}
                onChange={(e) => setCostBasis(Number(e.target.value))}
              />
            </label>

            <label style={styles.label}>
              Selling Fees / Commissions
              <input
                style={styles.input}
                type="number"
                value={sellingFees}
                onChange={(e) => setSellingFees(Number(e.target.value))}
              />
            </label>

            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={holdingPeriodLongTerm}
                onChange={(e) => setHoldingPeriodLongTerm(e.target.checked)}
              />
              Held More Than 1 Year (Long-Term Gain)
            </label>

            <label style={styles.label}>
              Capital Loss Carryforward Available
              <input
                style={styles.input}
                type="number"
                value={capitalLossCarryforward}
                onChange={(e) => setCapitalLossCarryforward(Number(e.target.value))}
              />
            </label>
          </section>
        </div>

        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Estimated Results</h2>

          <div style={styles.resultsGrid}>
            <Result label="Net Gain on Sale" value={formatCurrency(results.netSaleGain)} />
            <Result
              label="Gain Type"
              value={holdingPeriodLongTerm ? "Long-Term Capital Gain" : "Short-Term Capital Gain"}
            />
            <Result label="Taxable Ordinary Income" value={formatCurrency(results.taxableOrdinaryIncome)} />
            <Result label="Federal Tax on Ordinary Income" value={formatCurrency(results.federalOrdinaryTax)} />
            <Result label="Federal Tax on LTCG / Qualified Dividends" value={formatCurrency(results.federalLTCGTax)} />
            <Result label="Net Investment Income Tax" value={formatCurrency(results.niitTax)} />
            <Result label="Estimated State Tax" value={formatCurrency(results.estimatedStateTax)} />
            <Result label="Total Federal Tax" value={formatCurrency(results.totalFederalTax)} />
            <Result label="Total Estimated Tax" value={formatCurrency(results.totalEstimatedTax)} />
            <Result label="After-Tax Cash From Sale" value={formatCurrency(results.afterTaxCashFromSale)} />
            <Result
              label="Effective Tax Rate on Gain"
              value={formatPercent(results.effectiveTaxRateOnGain)}
            />
            <Result
              label="Unused Loss Carryforward Remaining"
              value={formatCurrency(results.remainingLossCarryforward)}
            />
          </div>
        </section>

        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Calculation Notes</h2>
          <ul style={styles.list}>
            <li>Short-term gains are taxed at ordinary income tax rates.</li>
            <li>Long-term gains and qualified dividends use stacked federal capital gains brackets.</li>
            <li>Net Investment Income Tax is estimated at 3.8% when income exceeds the applicable threshold.</li>
            <li>State treatment varies. This app uses a simple flat state tax input for estimating.</li>
            <li>This does not handle wash sales, collectibles, Section 1202 stock, depreciation recapture, AMT interactions, or every special tax rule.</li>
            <li>Tax figures are estimates for planning purposes only.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}

function Result({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.resultCard}>
      <div style={styles.resultLabel}>{label}</div>
      <div style={styles.resultValue}>{value}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#0b1220",
    color: "#e5e7eb",
    padding: "32px 16px",
    fontFamily: "Arial, sans-serif",
  },
  container: {
    maxWidth: 1200,
    margin: "0 auto",
  },
  title: {
    fontSize: 34,
    fontWeight: 700,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#94a3b8",
    marginBottom: 24,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 20,
    marginBottom: 20,
  },
  card: {
    background: "#111827",
    border: "1px solid #1f2937",
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 700,
    marginBottom: 16,
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 14,
    fontSize: 14,
    color: "#cbd5e1",
  },
  input: {
    background: "#0f172a",
    color: "#f8fafc",
    border: "1px solid #334155",
    borderRadius: 10,
    padding: "12px 14px",
    fontSize: 14,
  },
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
    fontSize: 14,
    color: "#cbd5e1",
  },
  resultsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 14,
  },
  resultCard: {
    background: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: 14,
    padding: 16,
  },
  resultLabel: {
    fontSize: 13,
    color: "#94a3b8",
    marginBottom: 8,
  },
  resultValue: {
    fontSize: 22,
    fontWeight: 700,
    color: "#f8fafc",
  },
  list: {
    margin: 0,
    paddingLeft: 18,
    color: "#cbd5e1",
    lineHeight: 1.7,
  },
};
