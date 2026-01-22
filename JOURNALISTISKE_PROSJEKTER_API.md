# Entur API – datamuligheter for journalistiske prosjekter

Denne appen bruker Entur Journey Planner GraphQL (`https://api.entur.io/journey-planner/v3/graphql`). Under er en praktisk oversikt over hva som faktisk finnes i API-et (verifisert via schema/curl), og hvilke typer journalistiske prosjekter det kan støtte.

Merk:
- Listen skiller mellom **(A) det vi allerede henter i appen** og **(B) utvidelser vi kan hente med flere GraphQL-felt/spørringer**.
- “Priser”/takster ligger ofte i egne Entur-tjenester/datasett (fare/tariff), og er ikke nødvendigvis tilgjengelig i Journey Planner v3 GraphQL. Det er likevel mulig å lage prisnære prosjekter ved å kombinere soner/takst-objekter fra andre kilder.

## 1) Stoppesteder og geografi

### A) Allerede i appen
- Henter stoppesteder innenfor et bbox-område via `stopPlacesByBbox`.
- Bruker kun `id` for stoppesteder (se `src/utils/entur.js`).

### B) Kan utvides til å hente (faktiske felter)
Felt som finnes på **StopPlace** i v3‑schemaet (verifisert via introspection):
- `name`, `latitude`, `longitude`
- `description`, `stopInterchangePriority`, `timeZone`
- `transportMode`, `transportSubmode`
- `tariffZones`
- `parent`
- `quays` (liste)
- `estimatedCalls` (liste)
- `situations` (liste)

Felt som finnes på **Quay** i v3‑schemaet (verifisert via introspection):
- `name`, `latitude`, `longitude`, `publicCode`, `stopType`, `timeZone`
- `wheelchairAccessible`
- `stopPlace`
- `lines` (liste), `journeyPatterns` (liste)
- `estimatedCalls` (liste)
- `situations` (liste)
- `tariffZones` (liste)

### Journalistiske vinkler
- “Hvilke områder mangler kollektivdekning?” (tetthet av stoppesteder vs befolkning/arbeidsplasser)
- “Universell utforming i praksis” (bruk `wheelchairAccessible` på Quay)
- “Stoppesteder med uvanlig mange avvik/innstillinger” (kobles med `situations`/RT)

## 2) Avgangsoversikt (real-time)

### A) Allerede i appen
Appen henter avgangene via `estimatedCalls` per quay:
- Planlagt vs forventet tid: `aimedDepartureTime`, `expectedDepartureTime`
- Realtidsflagg: `realtime`
- Destinasjonstekst: `destinationDisplay.frontText`
- Linjeinfo: `serviceJourney.line` (publicCode, name, transportMode) + `authority`

### B) Kan utvides til å hente (faktiske felter)
Felt som faktisk finnes på **EstimatedCall** (verifisert via introspection/curl):
- **Forsinkelser**: `aimedDepartureTime`, `expectedDepartureTime`, `actualDepartureTime`, `aimedArrivalTime`, `expectedArrivalTime`, `actualArrivalTime`
- **Kansellering/innstilling**: `cancellation` (boolean), `realtimeState` (enum)
- **Sanntidskvalitet**: `realtime`, `predictionInaccurate`, `empiricalDelay{p50,p90}`
- **Operativ info**: `forBoarding`, `forAlighting`, `requestStop`, `timingPoint`
- **Kapasitet**: `occupancyStatus`
- **Destinasjon og linje**: `destinationDisplay.frontText`, `destinationDisplay.via`, `serviceJourney.id`, `serviceJourney.line.{id, publicCode, name, transportMode, authority{id,name}}`

I tillegg finnes `situations` på StopPlace, Quay, Line og ServiceJourney i schemaet (se egne eksempler).

### Journalistiske vinkler (trafikkstudio – faktisk støttet)
- “Forsinkelsesligaen” per linje/operatør (bruk `expected` vs `aimed`)
- “Innstillingskartet” per linje/stopp (bruk `cancellation` + `realtimeState`)
- “Dagens verstinger akkurat nå” (største avvik + `predictionInaccurate`)
- “Trøkk og trengsel” på utvalgte linjer (bruk `occupancyStatus`)
- “Stopp med lav sanntidskvalitet” (`realtime=false` eller `predictionInaccurate=true`)

## 3) Linjer, ruter og mønstre

### A) Allerede i appen
- Henter grunnleggende linje-identitet via `serviceJourney.line`.

### B) Kan utvides til å hente (faktiske felter)
Felt som finnes på **Line** i v3‑schemaet (verifisert via introspection):
- `publicCode`, `name`, `description`, `url`
- `authority`, `operator`, `branding`, `presentation`
- `transportMode`, `transportSubmode`, `bikesAllowed`, `flexibleLineType`
- `journeyPatterns` (liste)
- `quays` (liste), `serviceJourneys` (liste)
- `notices` (liste), `situations` (liste)
- `groupOfLines` (liste)

### Journalistiske vinkler
- “Hvilke linjer binder sammen arbeidsmarkedet?” (nettverksanalyse)
- “Kort vs lang rute”: stoppmønstre og reisetider

## 3b) Båtruter (hurtigbåter og ferjer) – faktisk verifisert

Dette er støttet i Journey Planner v3. Båtruter dukker opp som:
- `transportMode: water`
- `transportSubmode`: f.eks. `highSpeedPassengerService` (hurtigbåt), `localCarFerry` (ferje), `localPassengerFerry`, `scheduledFerry`

**Verifisert eksempel (Brimse hurtigbåtkai):**

```bash
curl -s -X POST "https://api.entur.io/journey-planner/v3/graphql" \
	-H "Content-Type: application/json" \
	-H "ET-Client-Name: aftenbladet-forsinkelser" \
	-d '{"query":"query($id:String!){ stopPlace(id:$id){ id name transportMode quays { id name latitude longitude } } }","variables":{"id":"NSR:StopPlace:28626"}}'
```

```bash
curl -s -X POST "https://api.entur.io/journey-planner/v3/graphql" \
	-H "Content-Type: application/json" \
	-H "ET-Client-Name: aftenbladet-forsinkelser" \
	-d '{"query":"query($quayId:String!){ quay(id:$quayId){ id name estimatedCalls(timeRange: 21600, numberOfDepartures: 5){ aimedDepartureTime expectedDepartureTime cancellation realtimeState destinationDisplay { frontText via } serviceJourney { id line { id publicCode name transportMode transportSubmode authority { id name } } } } } }","variables":{"quayId":"NSR:Quay:49172"}}'
```

**Bekreftet:** `transportMode=water` og `transportSubmode=highSpeedPassengerService`/`localCarFerry` returnerer faktiske avganger.

### Journalistiske vinkler (båt)
- “Hurtigbåt‑forsinkelser vs ferje‑innstillinger” (bruk `transportSubmode` + `cancellation`)
- “Sjø‑knutepunkter med størst avvik” (quay‑nivå)
- “Båt vs buss i samme sone” (bruk `tariffZones` og `transportMode`)

## 4) Reiseruter (planlegging)

**Status i denne gjennomgangen:** ikke verifisert med curl. Hvis dere vil bruke ruteplanlegging, må vi først validere felter og spørringer i schemaet.

### Journalistiske vinkler
- “Tilgjengelighet”: reisetid til sykehus/skoler fra ulike områder
- “Bytte-stress”: områder med mange nødvendige bytter

## 5) Driftsavvik og hendelser (situations/disruptions)

Faktisk schema (verifisert): `situations` finnes på StopPlace, Quay, Line og ServiceJourney, med type `PtSituationElement`.

`PtSituationElement`‑felter som finnes i schemaet:
- `summary`, `description`, `advice` (liste av `MultilingualString`)
- `severity`, `reportType`, `priority`
- `validityPeriod { startTime endTime }`
- `creationTime`, `versionedAtTime`, `version`, `participant`, `situationNumber`

### Journalistiske vinkler
- “Hvilke typer avvik dominerer?” (vær, teknisk, vei)
- “Avvik-varmekart” (hvor skjer det oftest)

## 6) Historikk og trend (begrensning)

Journey Planner real-time er i hovedsak “nådata”. For historikk trenger dere:
- Lagring/innsamling over tid (egen database/pipeline)
- Eller et historikk-API/datasett om det finnes for deres bruk

### Journalistiske vinkler
- Punktlighet per uke/måned
- Før/etter-endring (ruteendring, anbudsbytte, veiarbeid)

## 7) Priser / takster

Viktig: “Priser” er ofte ikke direkte i Journey Planner v3 GraphQL.

Mulige veier til pris-prosjekter:
- Tariffsoner og takstregler fra egne fare/tariff-datasett (NeTEx fare / lokale kilder)
- Kombinere: stoppested (geografi) + sone-tilhørighet + taksttabeller

### Journalistiske vinkler
- “Hva koster det å pendle?” (sonebasert pris)
- “Prisendringer over tid” (krever historikk på takster)

## 8) Hva vi mangler i dagens implementasjon (konkret)

Basert på `src/utils/entur.js` er dagens “utnyttelse” begrenset av:
- Vi henter bare stoppested-`id` i `stopPlacesByBbox` (vi mister masse metadata som kunne blitt brukt til filtrering/segmentering).
- Vi kutter antall stopp per sone (`maxStops`), som kan gi skjev dekning.
- Vi henter kun 3 avganger per kai (`numberOfDepartures: 3`) og kun 2 timer fram (`timeRange: 7200`).
- Vi henter ikke `cancellation`, `realtimeState`, `predictionInaccurate`, `occupancyStatus`.

## 9) Neste steg (hvis dere vil)

Hvis du sier hva som er viktigst av:
1) pris/takst
2) komplett stoppested-oversikt
3) avgangsoversikt over tid (trend)

…kan jeg foreslå konkrete GraphQL-spørringer (felter) og en enkel innsamlingsstrategi (for historikk), tilpasset Rogaland.

---

# Konkret forslag (klar til bruk)

Nedenfor er et **minimum** av spørringer som gir bedre metadata og mer robuste avgangsdata, uten å endre appen dramatisk. Feltene er **verifisert mot schema** med curl‑spørringer (se “Curl‑verifisering” under).

## A) Utvid stoppesteder (navn, koordinater, type)

Bruk dette for å få navngivning og geografi i tillegg til `id`:

```graphql
query StopPlacesByBbox($minLat: Float!, $minLon: Float!, $maxLat: Float!, $maxLon: Float!) {
	stopPlacesByBbox(
		minimumLatitude: $minLat
		minimumLongitude: $minLon
		maximumLatitude: $maxLat
		maximumLongitude: $maxLon
	) {
		id
		name
		latitude
		longitude
		transportMode
		tariffZones {
			id
			name
		}
	}
}
```

Merk: `latitude`/`longitude` finnes i StopPlace‑schemaet. Felt som `centroid`, `municipality`, `county` er **ikke** tilgjengelige i v3‑schemaet.

## B) Utvid sanntidsavganger (mer detalj + historikk-klart)

Dette gir flere avganger og mer metadata per `estimatedCall`:

```graphql
query EstimatedCallsByQuay($quayId: String!, $timeRange: Int!, $limit: Int!) {
	quay(id: $quayId) {
		id
		name
		stopPlace {
			id
			name
		}
		estimatedCalls(timeRange: $timeRange, numberOfDepartures: $limit) {
			cancellation
			realtimeState
			predictionInaccurate
			occupancyStatus
			empiricalDelay { p50 p90 }
			aimedDepartureTime
			expectedDepartureTime
			actualDepartureTime
			aimedArrivalTime
			expectedArrivalTime
			actualArrivalTime
			realtime
			destinationDisplay {
				frontText
				via
			}
			serviceJourney {
				id
				line {
					id
					publicCode
					name
					transportMode
					transportSubmode
					operator { id name }
					authority {
						id
						name
					}
				}
			}
		}
	}
}
```

Anbefalt start: `timeRange: 14400` (4t) og `numberOfDepartures: 10` for bedre dekning.

## C) Avvik/situations (hvis schema støtter)

```graphql
query SituationsByLine($lineId: ID!) {
	line(id: $lineId) {
		id
		name
		situations {
			id
			severity
			validityPeriod {
				startTime
				endTime
			}
			summary {
				value
				language
			}
			description {
				value
				language
			}
		}
	}
}
```

---

# Curl‑verifisering (faktisk schema, januar 2026)

Bruk `ET-Client-Name` i alle kall. Disse kommandoene er kjørt og bekrefter hvilke felt som faktisk finnes.

**1) StopPlacesByBbox med koordinater + tariffsoner**

```bash
curl -s -X POST "https://api.entur.io/journey-planner/v3/graphql" \
	-H "Content-Type: application/json" \
	-H "ET-Client-Name: aftenbladet-forsinkelser" \
	-d '{"query":"query($minLat:Float!,$minLon:Float!,$maxLat:Float!,$maxLon:Float!){ stopPlacesByBbox(minimumLatitude:$minLat, minimumLongitude:$minLon, maximumLatitude:$maxLat, maximumLongitude:$maxLon){ id name latitude longitude transportMode tariffZones { id name } } }","variables":{"minLat":58.95,"minLon":5.7,"maxLat":59.02,"maxLon":5.95}}'
```

**Bekreftet:** `latitude`, `longitude`, `transportMode`, `tariffZones` finnes. `centroid`, `municipality`, `county` finnes **ikke**.

**2) EstimatedCalls med kansellering/innstilling**

```bash
curl -s -X POST "https://api.entur.io/journey-planner/v3/graphql" \
	-H "Content-Type: application/json" \
	-H "ET-Client-Name: aftenbladet-forsinkelser" \
	-d '{"query":"query($ids:[String!]!){ stopPlaces(ids:$ids){ id name quays { id name estimatedCalls(timeRange: 3600, numberOfDepartures: 3){ aimedDepartureTime expectedDepartureTime cancellation realtimeState destinationDisplay { frontText via } serviceJourney { id line { id publicCode name transportMode transportSubmode authority { id name } } } } } } }","variables":{"ids":["NSR:StopPlace:28173"]}}'
```

**Bekreftet:** `estimatedCalls` + `cancellation` + `realtimeState` + `destinationDisplay.via` + `transportSubmode` finnes og gir data.

**3) Situations på linje (PtSituationElement)**

```bash
curl -s -X POST "https://api.entur.io/journey-planner/v3/graphql" \
	-H "Content-Type: application/json" \
	-H "ET-Client-Name: aftenbladet-forsinkelser" \
	-d '{"query":"query($lineId:ID!){ line(id:$lineId){ id name situations { id severity validityPeriod { startTime endTime } summary { value language } } } }","variables":{"lineId":"KOL:Line:8_1013"}}'
```

**Bekreftet:** `line.situations` finnes, type er `PtSituationElement` med `summary`/`description` som `MultilingualString`. Eksempel over returnerte tom liste (ingen avvik på testtidspunkt).

**4) EstimatedCall‑felter (inkl. kansellering/innstilling)**

```bash
curl -s -X POST "https://api.entur.io/journey-planner/v3/graphql" \
	-H "Content-Type: application/json" \
	-H "ET-Client-Name: aftenbladet-forsinkelser" \
	-d '{"query":"query { __type(name: \"EstimatedCall\") { fields { name } } }"}'
```

**Bekreftet:** `cancellation`, `realtimeState`, `predictionInaccurate`, `occupancyStatus` finnes.

**5) Quay‑felter (for bedre geografi)**

```bash
curl -s -X POST "https://api.entur.io/journey-planner/v3/graphql" \
	-H "Content-Type: application/json" \
	-H "ET-Client-Name: aftenbladet-forsinkelser" \
	-d '{"query":"query { __type(name: \"Quay\") { fields { name } } }"}'
```

**Bekreftet:** `latitude`/`longitude` finnes på Quay, i tillegg til `stopType` og `publicCode`.

**6) Enum‑verdier (tolkning i trafikkstudio)**

```bash
curl -s -X POST "https://api.entur.io/journey-planner/v3/graphql" \
	-H "Content-Type: application/json" \
	-H "ET-Client-Name: aftenbladet-forsinkelser" \
	-d '{"query":"query { __type(name: \"RealtimeState\") { enumValues { name } } __type(name: \"OccupancyStatus\") { enumValues { name } } }"}'
```

**Bekreftet:** `RealtimeState` har bl.a. `scheduled`, `updated`, `canceled`, `Added`, `modified`. `OccupancyStatus` har bl.a. `empty`, `fewSeatsAvailable`, `standingRoomOnly`, `full`, `notAcceptingPassengers`.

**7) Båtruter (hurtigbåt/ferje)**

```bash
curl -s -X POST "https://api.entur.io/journey-planner/v3/graphql" \
	-H "Content-Type: application/json" \
	-H "ET-Client-Name: aftenbladet-forsinkelser" \
	-d '{"query":"query($quayId:String!){ quay(id:$quayId){ id name estimatedCalls(timeRange: 21600, numberOfDepartures: 5){ aimedDepartureTime expectedDepartureTime cancellation realtimeState destinationDisplay { frontText via } serviceJourney { id line { id publicCode name transportMode transportSubmode authority { id name } } } } } }","variables":{"quayId":"NSR:Quay:49172"}}'
```

**Bekreftet:** `transportMode=water` med `transportSubmode` som hurtigbåt/ferje og vanlige RT‑felter.

---

# Schema‑sjekk (før prod)

Hvis dere bytter region/operatør, kjør curl‑sjekkene igjen for å sikre feltnavn og forventet datadekning.

---

# Enkel implementasjonsplan (Rogaland)

**Mål:** Mer metadata + historikkgrunnlag for punktlighet.

1) **Utvid stoppesteder**
	 - Legg til `name`, `latitude`, `longitude`, `transportMode`, `tariffZones`.
	 - Lagre resultatet lokalt (cache/JSON) for rask filtrering.

2) **Forbedre geografisk sortering (trafikkstudio)**
	 - Bruk `latitude`/`longitude` på StopPlace/Quay for polygon‑filtrering (kommuner/bydeler).
	 - Bruk `tariffZones` som grov soneinndeling.
	 - Legg inn en enkel reverse‑geokoding mot kommunedata (SSB) for kommune/fylke.

3) **Øk RT‑dekning**
	 - Hent 8–12 avganger per kai.
	 - Øk `timeRange` til 4–6 timer i rush.
	 - Logg `aimed` og `expected` for punklighet.

4) **Lagring for historikk**
	 - Cron hvert 5.–10. minutt for utvalgte stopper.
	 - Lagre i enkel DB (SQLite/Postgres) med tid, lineId, quayId.

---

# Datakvalitet/forbehold

- **RT‑dekning er ujevn**: enkelte operatører/linjer gir ikke full sanntid.
- **Tidsrom er “nådata”**: historikk må samles inn over tid.
- **Stoppested‑metadata kan være ufullstendig**: krever ofte geografisk berikelse (SSB/kommunedata).
- **Kanselleringer**: ikke alltid eksplisitt i Journey Planner; må tolkes via RT‑endringer.

