"""Flood Frequency Analysis engine."""
from __future__ import annotations

import logging
import warnings
from typing import Optional

import numpy as np
import scipy.stats as stats
from lmoments3 import distr

from .models import (
    CurvePoint,
    DistributionResult,
    FfaWarning,
    FrequencyRequest,
    FrequencyResponse,
    GoodnessOfFit,
    PlottingPoint,
    Quantile,
)

logger = logging.getLogger(__name__)

DIST_LABELS = {
    "gev": "Generalized Extreme Value (GEV)",
    "glo": "Generalized Logistic (GLO)",
    "gumbel": "Gumbel (EV1)",
    "lp3": "Log-Pearson III (LP3)",
    "pe3": "Pearson III (PE3)",
}

PLOTTING_A = {"cunnane": 0.4, "weibull": 0.0, "gringorten": 0.44}


def plotting_positions(values: np.ndarray, years: list[int], method: str) -> list[PlottingPoint]:
    n = len(values)
    a = PLOTTING_A[method]
    sorted_idx = np.argsort(values)[::-1]  # descending (rank 1 = largest)
    result = []
    for rank, idx in enumerate(sorted_idx, start=1):
        ep = (rank - a) / (n + 1 - 2 * a)
        ep = max(1e-6, min(1 - 1e-6, ep))
        result.append(
            PlottingPoint(
                year=years[idx],
                value=float(values[idx]),
                exceedance_prob=ep,
                return_period=1.0 / ep,
            )
        )
    return result


def _quantile_from_params(dist_key: str, params: dict, p_nonexceed: float) -> float:
    """Return quantile for non-exceedance probability p."""
    if dist_key == "gev":
        return float(stats.genextreme.ppf(p_nonexceed, c=-params["k"], loc=params["loc"], scale=params["scale"]))
    if dist_key == "glo":
        return float(distr.glo.ppf(p_nonexceed, **params))
    if dist_key == "gumbel":
        return float(stats.gumbel_r.ppf(p_nonexceed, loc=params["loc"], scale=params["scale"]))
    if dist_key in ("pe3", "lp3"):
        return float(distr.pe3.ppf(p_nonexceed, **params))
    raise ValueError(f"Unknown dist: {dist_key}")


def _loglik(dist_key: str, params: dict, data: np.ndarray) -> float:
    try:
        if dist_key == "gev":
            return float(np.sum(stats.genextreme.logpdf(data, c=-params["k"], loc=params["loc"], scale=params["scale"])))
        if dist_key == "glo":
            return float(np.sum(distr.glo.logpdf(data, **params)))
        if dist_key == "gumbel":
            return float(np.sum(stats.gumbel_r.logpdf(data, loc=params["loc"], scale=params["scale"])))
        if dist_key in ("pe3", "lp3"):
            return float(np.sum(distr.pe3.logpdf(data, **params)))
    except Exception:
        return float("-inf")
    return float("-inf")


def _fit_lmoments(dist_key: str, data: np.ndarray) -> dict:
    fit_data = np.log10(data) if dist_key == "lp3" else data
    if dist_key == "gev":
        return distr.gev.lmom_fit(fit_data)
    if dist_key == "glo":
        return distr.glo.lmom_fit(fit_data)
    if dist_key == "gumbel":
        return distr.gum.lmom_fit(fit_data)
    if dist_key in ("pe3", "lp3"):
        return distr.pe3.lmom_fit(fit_data)
    raise ValueError(f"Unknown dist: {dist_key}")


def _fit_mom_lp3(data: np.ndarray) -> dict:
    log_q = np.log10(data)
    mu, sigma, skew = float(np.mean(log_q)), float(np.std(log_q, ddof=1)), float(stats.skew(log_q))
    return {"loc": mu, "scale": sigma, "skew": skew}


def _quantile(dist_key: str, params: dict, return_period: float) -> float:
    p = 1.0 - 1.0 / return_period
    q = _quantile_from_params(dist_key, params, p)
    return 10**q if dist_key == "lp3" else q


def _ks_ad(dist_key: str, params: dict, data: np.ndarray):
    try:
        def cdf(x):
            if dist_key == "gev":
                return stats.genextreme.cdf(x, c=-params["k"], loc=params["loc"], scale=params["scale"])
            if dist_key == "glo":
                return distr.glo.cdf(x, **params)
            if dist_key == "gumbel":
                return stats.gumbel_r.cdf(x, loc=params["loc"], scale=params["scale"])
            if dist_key in ("pe3", "lp3"):
                return distr.pe3.cdf(x, **params)
            return np.zeros_like(x)

        fit_data = np.log10(data) if dist_key == "lp3" else data
        ks = stats.kstest(fit_data, cdf)
        ad_result = stats.anderson(fit_data)
        return float(ks.statistic), float(ks.pvalue), float(ad_result.statistic)
    except Exception:
        return float("nan"), float("nan"), float("nan")


def _n_params(dist_key: str) -> int:
    return 2 if dist_key == "gumbel" else 3


def fit_distribution(
    dist_key: str,
    data: np.ndarray,
    years: list[int],
    return_periods: list[float],
    estimation_method: str,
    plotting_pts: list[PlottingPoint],
    ci_method: str,
    confidence_level: float,
    bootstrap_samples: int,
    rng: np.random.Generator,
) -> DistributionResult:
    label = DIST_LABELS.get(dist_key, dist_key)

    try:
        if estimation_method == "mom" and dist_key == "lp3":
            params = _fit_mom_lp3(data)
        else:
            params = _fit_lmoments(dist_key, data)

        k = _n_params(dist_key)
        fit_data = np.log10(data) if dist_key == "lp3" else data
        ll = _loglik(dist_key, params, fit_data)
        n = len(data)
        aic = 2 * k - 2 * ll
        bic = k * np.log(n) - 2 * ll

        quantile_vals = [_quantile(dist_key, params, t) for t in return_periods]

        emp_q = np.array([_quantile(dist_key, params, pp.return_period) for pp in plotting_pts])
        obs_q = np.array([pp.value for pp in plotting_pts])
        rmse = float(np.sqrt(np.mean((emp_q - obs_q) ** 2)))

        ks_stat, ks_pval, ad_stat = _ks_ad(dist_key, params, data)

        # Bootstrap CIs
        ci_lower = [None] * len(return_periods)
        ci_upper = [None] * len(return_periods)
        if ci_method == "bootstrap" and n >= 5:
            boot_quantiles = np.zeros((bootstrap_samples, len(return_periods)))
            alpha = (1 - confidence_level) / 2
            for b in range(bootstrap_samples):
                sample = rng.choice(data, size=n, replace=True)
                try:
                    if estimation_method == "mom" and dist_key == "lp3":
                        bp = _fit_mom_lp3(sample)
                    else:
                        bp = _fit_lmoments(dist_key, sample)
                    boot_quantiles[b] = [_quantile(dist_key, bp, t) for t in return_periods]
                except Exception:
                    boot_quantiles[b] = np.nan
            for i in range(len(return_periods)):
                col = boot_quantiles[:, i]
                valid = col[~np.isnan(col)]
                if len(valid) > 10:
                    ci_lower[i] = float(np.percentile(valid, alpha * 100))
                    ci_upper[i] = float(np.percentile(valid, (1 - alpha) * 100))

        quantiles = [
            Quantile(
                return_period=t,
                aep=round(1.0 / t, 6),
                value=round(q, 3),
                ci_lower=round(lo, 3) if lo is not None else None,
                ci_upper=round(hi, 3) if hi is not None else None,
            )
            for t, q, lo, hi in zip(return_periods, quantile_vals, ci_lower, ci_upper)
        ]

        # Dense curve for smooth plotting
        curve_rps = np.unique(
            np.concatenate([
                np.logspace(np.log10(1.01), np.log10(1000), 200),
                return_periods,
            ])
        )
        curve = [CurvePoint(return_period=float(t), value=round(_quantile(dist_key, params, t), 3)) for t in curve_rps]

        params_out = {k: round(float(v), 6) for k, v in params.items()}

        return DistributionResult(
            key=dist_key,
            label=label,
            estimation_method=estimation_method,
            parameters=params_out,
            quantiles=quantiles,
            curve=curve,
            goodness_of_fit=GoodnessOfFit(
                ks_stat=round(ks_stat, 6),
                ks_pvalue=round(ks_pval, 6),
                ad_stat=round(ad_stat, 6),
                aic=round(aic, 3),
                bic=round(bic, 3),
                rmse=round(rmse, 3),
            ),
            fit_error=None,
        )

    except Exception as e:
        logger.warning("Distribution %s failed: %s", dist_key, e)
        return DistributionResult(
            key=dist_key,
            label=label,
            estimation_method=estimation_method,
            parameters={},
            quantiles=[],
            curve=[],
            goodness_of_fit=None,
            fit_error=str(e),
        )


def build_warnings(
    n: int, regulated: bool | None, excluded_count: int, return_periods: list[float]
) -> list[FfaWarning]:
    warns = []
    if n < 10:
        warns.append(FfaWarning(
            level="error", code="record_length",
            message=f"Only {n} years of peak data — results are unreliable. At least 10 years recommended.",
        ))
    elif n < 20:
        warns.append(FfaWarning(
            level="caution", code="record_length",
            message=f"{n} years of peak data — results are acceptable but limited. 20+ years preferred.",
        ))
    else:
        warns.append(FfaWarning(
            level="info", code="record_length",
            message=f"{n} years of peak data used in analysis.",
        ))

    if regulated:
        warns.append(FfaWarning(
            level="warning", code="regulation",
            message="This station is regulated. Flood frequency analysis assumes natural, stationary flow. Regulation may invalidate these results.",
        ))

    if excluded_count > 0:
        warns.append(FfaWarning(
            level="info", code="excluded_peaks",
            message=f"{excluded_count} peak(s) with 'Estimated' symbol excluded from analysis.",
        ))

    max_rp = max(return_periods)
    if max_rp > 2 * n:
        warns.append(FfaWarning(
            level="caution", code="extrapolation",
            message=f"Return period T={int(max_rp)} yr greatly exceeds the record length ({n} yr). Long extrapolation — treat with caution.",
        ))

    return warns


def run_ffa(req: FrequencyRequest) -> FrequencyResponse:
    rng = np.random.default_rng(req.random_seed)

    excluded = []
    peaks = list(req.peaks)
    if req.exclude_estimated:
        kept = []
        for p in peaks:
            if p.symbol and p.symbol.strip().upper() == "E":
                excluded.append({"year": p.year, "reason": "estimated"})
            else:
                kept.append(p)
        peaks = kept

    n = len(peaks)
    years_used = [p.year for p in peaks]
    data = np.array([p.value for p in peaks], dtype=float)

    if n < 5:
        return FrequencyResponse(
            n_years=n, years_used=years_used, excluded=excluded,
            warnings=[FfaWarning(level="error", code="too_few_years",
                                 message=f"Only {n} years of data — cannot fit distributions (minimum 5 required).")],
            plotting_positions=[], distributions=[], best_fit=None,
            best_fit_metric="aic", too_few_years=True,
        )

    # Guard non-positive values for LP3
    if np.any(data <= 0):
        warnings.warn("Non-positive peak values found; excluding from LP3 fit.")

    pp = plotting_positions(data, years_used, req.plotting_position)
    warns = build_warnings(n, None, len(excluded), req.return_periods)

    results = []
    for dk in req.distributions:
        fit_data = data.copy()
        if dk == "lp3" and np.any(fit_data <= 0):
            fit_data = fit_data[fit_data > 0]
        r = fit_distribution(
            dk, fit_data, years_used, req.return_periods,
            req.estimation_method, pp, req.ci_method,
            req.confidence_level, req.bootstrap_samples, rng,
        )
        results.append(r)

    # Best fit by AIC (lowest)
    best_fit = None
    best_aic = float("inf")
    for r in results:
        if r.fit_error is None and r.goodness_of_fit and r.goodness_of_fit.aic < best_aic:
            best_aic = r.goodness_of_fit.aic
            best_fit = r.key

    return FrequencyResponse(
        n_years=n, years_used=years_used, excluded=excluded,
        warnings=warns, plotting_positions=pp,
        distributions=results, best_fit=best_fit,
        best_fit_metric="aic",
    )
