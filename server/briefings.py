import os


HARDCODED_BRIEFINGS = {
    "easy": {
        "nashik": "District: Nashik, Maharashtra. Weather: Clear skies for the past week. Generator at DVS_Barmer was serviced 2 months ago and is in good condition. No reported sensor issues. Truck will arrive on schedule. Vaccination coverage target: 85% of eligible children.",
        "barmer": "District: Barmer, Rajasthan. Weather: Clear, minimal risk. All infrastructure stable. Generator fuel levels adequate. No sensor malfunctions recorded. Expected vaccination sessions: 12 outreach clinics across PHC_Sindhari and CHC_Balotra.",
        "godda": "District: Godda, Jharkhand. Weather: Light rain expected but manageable. Existing infrastructure operational. No critical hazards noted. Sensor calibration is current. Plan for 200 eligible beneficiaries this cycle.",
    },
    "medium": {
        "nashik": "District: Nashik, Maharashtra. Weather: Intermittent rain for 1 day. Generator at DVS_Barmer was last serviced 5 months ago—routine maintenance recommended soon. Sensor at CHC_Balotra flagged a minor calibration drift in last inspection. Truck may be 2 hours late. Vaccination coverage target: 90% of 180 eligible children.",
        "barmer": "District: Barmer, Rajasthan. Weather: Heavy rainfall yesterday, ground conditions muddy. Generator last serviced 6 months ago; monitor fuel consumption. Sensor at PHC_Sindhari showed a 0.8°C offset last quarter but was recalibrated. Outreach clinics: 15 sessions planned.",
        "godda": "District: Godda, Jharkhand. Weather: Rain expected for the next 48 hours. Generator maintenance is due in 1 month. No current sensor issues but CHC_Balotra sensor has a history of drift. Beneficiary count: 220 children and 70 elderly to reach.",
    },
    "hard": {
        "nashik": "District: Nashik, Maharashtra. Weather: Heavy rainfall ongoing for 2 days, flood risk in low-lying areas. Generator at DVS_Barmer last serviced 8 months ago and fuel consumption has increased—risk of unexpected failure. Sensor at CHC_Balotra flagged a calibration fault last quarter and has not been recalibrated; readings may be 1.5–3.0°C above true temperature. Truck delayed 4 hours due to flooding. Ethical note: 200 children vs 70 elderly—prioritize based on clinical need. Vaccination coverage target: 95%.",
        "barmer": "District: Barmer, Rajasthan. Weather: Severe heat and occasional dust storms. Generator at DVS_Barmer was last serviced 8 months ago; fuel pump showing wear. Sensor at PHC_Sindhari flagged a calibration fault last quarter and has drifted; expect readings to be 1.5–2.5°C above actual. Truck arrival uncertain. Critical population: 200 children under 5, 70 elderly. Balance vaccination coverage with resource constraints.",
        "godda": "District: Godda, Jharkhand. Weather: Continuous heavy rainfall, waterlogging in multiple taluks, road access compromised. Generator at CHC_Balotra last serviced 8 months ago and showing strain; failure probability elevated. Sensor at DVS_Barmer has a known calibration fault (flagged 2 quarters ago) and reads 1.5–3.0°C above true temperature. Truck status unknown due to flooding. Ethical priority: 200 children under 5 vs 70 elderly. Coverage target: 100% of reachable population.",
    },
}


def generate_briefing(difficulty: str, district: str, user_briefing: str = None) -> str:
    """
    Generate a district briefing for the vaccine cold chain environment.

    Three-mode fallback:
    1. If user_briefing is provided, use it directly.
    2. If OpenAI API key exists and call succeeds, generate via GPT-4o-mini.
    3. Otherwise, fall back to hardcoded briefing keyed on difficulty and district.

    Args:
        difficulty: One of "easy", "medium", "hard"
        district: One of "nashik", "barmer", "godda"
        user_briefing: Optional user-provided briefing text

    Returns:
        A natural-language briefing string describing district conditions, hazards, and sensor reliability notes.
    """
    if user_briefing:
        return user_briefing

    api_key = os.getenv("OPENAI_API_KEY")
    if api_key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=api_key)
            prompt = f"""You are an expert in vaccine cold chain logistics in rural India.
Generate a brief natural-language district briefing for a vaccine cold chain management scenario.
The briefing should describe:
- Current weather and hazard probabilities (e.g., "rainfall has been heavy for two days")
- Generator status and last service date (relevant to failure probability in difficulty={difficulty})
- Sensor reliability notes (sensor may have calibration faults, especially in hard mode)
- Truck status and expected arrival time
- Relevant demographics (e.g., "200 children under 5, 70 elderly")

District: {district.capitalize()}
Difficulty level: {difficulty}

Keep the briefing to 3-4 sentences, specific, and actionable for an LLM agent."""

            response = client.chat.completions.create(
                model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
                messages=[{"role": "user", "content": prompt}],
                temperature=0.7,
                max_tokens=300,
            )
            briefing = response.choices[0].message.content.strip()
            print(f"[INFO] Generated briefing via OpenAI for {district}/{difficulty}")
            return briefing
        except Exception as e:
            print(f"[WARNING] OpenAI briefing generation failed: {e}. Falling back to hardcoded.")

    if difficulty in HARDCODED_BRIEFINGS and district in HARDCODED_BRIEFINGS[difficulty]:
        print(f"[INFO] Using hardcoded briefing for {district}/{difficulty}")
        return HARDCODED_BRIEFINGS[difficulty][district]

    print(f"[ERROR] No briefing found for {difficulty}/{district}. Returning generic fallback.")
    return f"District: {district.capitalize()}. Difficulty: {difficulty}. All systems operational."
