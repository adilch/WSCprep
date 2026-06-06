export default function AboutPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-8 text-sm leading-relaxed text-gray-700">
      <h1 className="text-2xl font-semibold text-gray-900">About this application</h1>

      <section>
        <h2 className="font-semibold text-gray-800 mb-2">Purpose</h2>
        <p>
          This web application provides access to Water Survey of Canada (WSC) hydrometric data and statistical tools for
          water resources engineering. Users can discover gauging stations across Canada, explore full periods of record,
          and perform rigorous flood frequency analysis.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-gray-800 mb-2">Data sources</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>
            Station metadata:{" "}
            <strong>HYDAT</strong> (WSC archival database, distributed as SQLite by Environment and Climate Change Canada).
          </li>
          <li>
            Time-series data: <strong>ECCC GeoMet OGC API</strong> (
            <a href="https://api.weather.gc.ca" className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">
              api.weather.gc.ca
            </a>
            ) — daily mean and annual instantaneous peak discharge and water level.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="font-semibold text-gray-800 mb-2">Flood frequency methodology</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>Annual maximum instantaneous discharge series (AMS) from pre-computed ECCC peaks.</li>
          <li>Distributions: GEV, GLO, Gumbel (EV1), Pearson III (PE3), Log-Pearson III (LP3).</li>
          <li>Parameter estimation: L-moments (default); Method of Moments available for LP3.</li>
          <li>Plotting positions: Cunnane (default), Weibull, Gringorten.</li>
          <li>Confidence intervals: non-parametric bootstrap (B = 2,000 by default).</li>
          <li>Best-fit ranking: lowest AIC.</li>
        </ul>
      </section>

      <section>
        <h2 className="font-semibold text-gray-800 mb-2">Licence &amp; attribution</h2>
        <p>
          Hydrometric data are © Environment and Climate Change Canada and distributed under the{" "}
          <a
            href="https://eccc-msc.github.io/open-data/licence/readme_en/"
            className="text-blue-600 underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            ECCC Open Government Licence
          </a>
          . This application is not affiliated with or endorsed by ECCC or the Water Survey of Canada.
        </p>
        <p className="mt-2">Map tiles © OpenStreetMap contributors (ODbL).</p>
      </section>

      <section>
        <h2 className="font-semibold text-gray-800 mb-2">Disclaimer</h2>
        <p>
          This tool is provided for informational and educational purposes. Flood frequency results are statistical
          estimates subject to considerable uncertainty, particularly for short records, regulated rivers, and long return
          periods. Always verify results with a qualified professional before using in design or regulatory contexts.
        </p>
      </section>
    </div>
  );
}
