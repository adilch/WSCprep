from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator


class PeakInput(BaseModel):
    year: int
    value: float
    date: Optional[str] = None
    symbol: Optional[str] = None


class FrequencyRequest(BaseModel):
    station_id: Optional[str] = None
    variable: str = "discharge"
    peaks: list[PeakInput]
    distributions: list[str] = ["gev", "glo", "gumbel", "lp3", "pe3"]
    estimation_method: Literal["lmoments", "mom"] = "lmoments"
    plotting_position: Literal["cunnane", "weibull", "gringorten"] = "cunnane"
    return_periods: list[float] = [2, 5, 10, 20, 25, 50, 100, 200, 500]
    exclude_estimated: bool = True
    confidence_level: float = Field(0.90, gt=0, lt=1)
    ci_method: Literal["bootstrap", "none"] = "bootstrap"
    bootstrap_samples: int = Field(2000, ge=100, le=10000)
    random_seed: int = 42

    @field_validator("return_periods")
    @classmethod
    def positive_rps(cls, v: list[float]) -> list[float]:
        if any(t <= 1 for t in v):
            raise ValueError("Return periods must be > 1")
        return v


class Quantile(BaseModel):
    return_period: float
    aep: float
    value: float
    ci_lower: Optional[float]
    ci_upper: Optional[float]


class GoodnessOfFit(BaseModel):
    ks_stat: float
    ks_pvalue: float
    ad_stat: float
    aic: float
    bic: float
    rmse: float


class CurvePoint(BaseModel):
    return_period: float
    value: float


class DistributionResult(BaseModel):
    key: str
    label: str
    estimation_method: str
    parameters: dict[str, float]
    quantiles: list[Quantile]
    curve: list[CurvePoint]
    goodness_of_fit: Optional[GoodnessOfFit]
    fit_error: Optional[str]


class PlottingPoint(BaseModel):
    year: int
    value: float
    exceedance_prob: float
    return_period: float


class FfaWarning(BaseModel):
    level: Literal["info", "caution", "warning", "error"]
    code: str
    message: str


class FrequencyResponse(BaseModel):
    n_years: int
    years_used: list[int]
    excluded: list[dict]
    warnings: list[FfaWarning]
    plotting_positions: list[PlottingPoint]
    distributions: list[DistributionResult]
    best_fit: Optional[str]
    best_fit_metric: str
    too_few_years: bool = False
