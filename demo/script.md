# Demo video script
Timestamps match demo_video_silent.mp4.

**[0:00] s01_intro**

Hi, I'm Chandra, a first-year student in the Master of Artificial Intelligence Systems Management program at Carnegie Mellon University. This video is my submission to the AI Horizons Pittsburgh hackathon, housing track. I built an AI-powered dashboard for exploring property sale prices in Allegheny County.

**[0:18] s02_problem**

The county publishes every property sale, but the raw data is messy. Out of three hundred sixty-seven thousand records from 2016 to 2026, almost a third are one-dollar deeds, family transfers, or duplicates. So I built a cleaning pipeline, an interactive map and dashboard, and a question-and-answer assistant powered by Claude, that is honest about data quality.

**[0:48] s03_overview**

Here is the dashboard, running live. The filter bar at the top controls everything: which sales to include, and the year range. By default, it uses only sales the county assessor validated as real market sales. The 2025 median is two hundred seventy thousand dollars, up seventy-four percent since 2016.

**[1:13] s04_map**

The map shows every municipality, with Pittsburgh split into its thirty-two wards. I built these shapes from the county's parcel boundary file, merging more than half a million parcels. Hovering shows the median price and how many sales are behind it. Grey places have fewer than thirty sales, so a noisy number never looks solid.

**[1:40] s05_click**

Clicking a place zooms in and puts every individual sale on the map. Here is Mount Lebanon. The card shows the median, the price change, and the sample size behind each number. Clicking a dot shows the address, price, and date of that sale.

**[2:03] s06_years**

Now I switch the map to price change. About half the county turns grey, because the assessor validated very few sales in 2016 and 2017. That is a real data quality problem, and the map shows it instead of hiding it. Switching to all priced sales fills most of it back in. And with the Since 2020 preset, every panel updates to the post-pandemic market.

**[2:36] s07_charts**

Below the map, the trend chart compares the places I clicked with the whole county, and the municipality table ranks all one hundred thirty places, with low sample badges where the data is thin.

**[2:55] s08_quality**

The data quality panel documents every cleaning step, how many rows each one removed, and how validation coverage changes by year.

**[3:04] s09_ask**

Now the AI part. From the map card, I ask Claude about Mount Lebanon. Claude never sees the raw data directly. It calls read-only query tools on the cleaned dataset, and the interface lists every query it ran.

**[3:21] s10_answer**

The answer streams in with a table. It gives the sample size behind each number, cross-checks against all priced sales, and ends with data notes. Every number traces back to a query you can inspect.

**[3:38] s11_followup**

Follow-up questions keep the context. When I ask about Haysville, one of the smallest boroughs, Claude says plainly that a handful of sales cannot support a trend, instead of inventing one.

**[4:01] s12_honest**

To be clear about what is real: everything you saw is working. The data, the map, the charts, and Claude's answers are live, and nothing is mocked. The limitations: it runs locally and is not deployed yet. The county sales file has no property type, so medians mix houses, condos, and land. 2026 is a partial year. And in testing, Claude once drew a wrong conclusion from correct numbers, so answers should still be read critically. I built this with Claude Code as my coding assistant.

**[4:43] s13_outro**

Next steps are deploying it, adding property types from the county assessment data, and letting people compare their own home with its neighborhood. Thank you for watching.
