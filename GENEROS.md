# HOTU — Taxonomía de géneros

Convertido de `HOTU_DJ_Genre_Classification_2026.docx` (v1.0, septiembre 2026). **Este archivo es la fuente de verdad**: el `.docx` se borró del repo porque un binario no se puede revisar en un diff ni corregir sin Word.

`lib/genre-taxonomy.ts` se llena desde acá. Si editás este archivo, hay que regenerar ese otro y volver a correr `/api/seed-genres`.

**34 branches, 719 tags.**

---

## Reglas

- Every DJ selects exactly one Primary Branch.
- Allow up to 3 Secondary Branches for hybrid identities.
- Allow 3–8 genre Tags per DJ; rank the first 3 as Primary Tags.
- Keep Open Format / Crossover as DJ Type, not as a genre Branch.
- Keep era and context labels separate from genre so “90s” or “Festival” can work everywhere.
- Do not automatically infer a parent Branch from a Tag when a tag is transversal (e.g., Acid, Melodic, Industrial).
- Use aliases for search (DnB = Drum & Bass; UKG = Garage; Guaracha = Aleteo/Zapateo where appropriate) while displaying one canonical label.
- Review the taxonomy quarterly; new scene labels can be added as Tags before being promoted to Branches.

---

## Branches

| # | Código | Branch | Categoría | Tags |
|---|---|---|---|---|
| 01 | `HOU` | HOUSE | ELECTRONIC / CLUB | 43 |
| 02 | `TEC` | TECHNO | ELECTRONIC / CLUB | 30 |
| 03 | `TCH` | TECH HOUSE | ELECTRONIC / CLUB | 15 |
| 04 | `MEL` | MELODIC | ELECTRONIC / CLUB | 16 |
| 05 | `MIN` | MINIMAL | ELECTRONIC / CLUB | 15 |
| 06 | `ACI` | ACID | ELECTRONIC / CLUB | 15 |
| 07 | `GRO` | GROOVE | ELECTRONIC / CLUB | 16 |
| 08 | `BOU` | BOUNCE | ELECTRONIC / CLUB | 14 |
| 09 | `IND` | INDUSTRIAL | ELECTRONIC / CLUB | 15 |
| 10 | `TRI` | TRIBAL | ELECTRONIC / CLUB | 15 |
| 11 | `TRA` | TRANCE | ELECTRONIC / CLUB | 20 |
| 12 | `PSY` | PSY | ELECTRONIC / CLUB | 20 |
| 13 | `HDC` | HARDCORE | ELECTRONIC / CLUB | 25 |
| 14 | `DNB` | DRUM & BASS | ELECTRONIC / CLUB | 26 |
| 15 | `GAR` | GARAGE | ELECTRONIC / CLUB | 18 |
| 16 | `BAS` | DUBSTEP / BASS | ELECTRONIC / CLUB | 26 |
| 17 | `GUA` | GUARACHA | ELECTRONIC / LATIN | 14 |
| 18 | `AFR` | AFRO | ELECTRONIC / AFRICAN | 19 |
| 19 | `AMA` | AMAPIANO | ELECTRONIC / AFRICAN | 15 |
| 20 | `EDM` | EDM / MAINSTAGE | ELECTRONIC / FESTIVAL | 20 |
| 21 | `ELC` | ELECTRO | ELECTRONIC / CLUB | 19 |
| 22 | `DIS` | DISCO | DANCE / CLASSICS | 24 |
| 23 | `TFB` | TRAP / FUTURE BASS | ELECTRONIC / URBAN | 18 |
| 24 | `REG` | REGGAETÓN | LATIN / URBAN | 26 |
| 25 | `HIP` | HIP-HOP | URBAN / OPEN FORMAT | 28 |
| 26 | `RNB` | R&B | URBAN / OPEN FORMAT | 20 |
| 27 | `POP` | POP / TOP 40 | MAINSTREAM / OPEN FORMAT | 29 |
| 28 | `AFB` | AFROBEATS | AFRICAN / URBAN | 19 |
| 29 | `CAR` | REGGAE / DANCEHALL | CARIBBEAN / OPEN FORMAT | 21 |
| 30 | `BRF` | BRAZILIAN FUNK | BRAZIL / URBAN | 19 |
| 31 | `LAT` | LATIN / TROPICAL | LATIN / OPEN FORMAT | 26 |
| 32 | `ROC` | ROCK | ROCK / OPEN FORMAT | 30 |
| 33 | `FUN` | FUNK / SOUL | DANCE / CLASSICS | 23 |
| 34 | `CTY` | COUNTRY | OPEN FORMAT / US | 20 |

---

## 01 · HOU · HOUSE

Categoría: ELECTRONIC / CLUB

- Acid House
- Funky House
- Organic House
- Afro House
- Future House
- Outsider House
- Ambient House
- G-House
- Phonk House
- Balearic House / Balearic Beat
- Garage House
- Progressive House
- Ballroom House
- Ghetto House
- Slap House
- Bass House
- Gospel House
- Soulful House
- Big Room House
- Hard House
- Speed House
- Brazilian Bass
- Hip House
- Stutter House
- Chicago House
- Italo House
- Tech House
- Classic House
- Jackin House
- Tribal House
- Deep House
- Jazz House
- Tropical House
- Diva House
- Latin House
- UK Jackin
- Electro House
- Lo-Fi House
- Vocal House
- Euro House
- Melodic House
- French House
- Microhouse

## 02 · TEC · TECHNO

Categoría: ELECTRONIC / CLUB

- Acid Techno
- Hypnotic Techno
- Dubwise Techno
- Ambient Techno
- Industrial Techno
- Rave Techno
- Birmingham Techno
- Melodic Techno
- Warehouse Techno
- Broken Techno
- Minimal Techno
- Mental Techno
- Deep Techno
- Peak Time Techno
- Freetekno / Tekno
- Detroit Techno
- Driving Techno
- Hardtek
- Dub Techno
- Psy-Techno
- Jungle Techno
- EBM Techno
- Raw Techno
- Ghettotech
- Hard Techno
- Schranz
- Wonky Techno
- Hardgroove Techno
- Tribal Techno
- Techno Bass

## 03 · TCH · TECH HOUSE

Categoría: ELECTRONIC / CLUB

- Classic Tech House
- Tribal Tech House
- Funky Tech House
- Deep Tech House
- Afro Tech House
- Progressive Tech House
- Latin Tech
- Acid Tech House
- Vocal Tech House
- Minimal Tech House
- Melodic Tech House
- Underground Tech House
- Groovy Tech House
- Bass Tech House
- Peak-Time Tech House

## 04 · MEL · MELODIC

Categoría: ELECTRONIC / CLUB

- Melodic House
- Melodic Dubstep
- Organic Melodic
- Melodic Techno
- Melodic DnB
- Deep Melodic
- Melodic House & Techno
- Melodic Hardcore
- Dark Melodic
- Progressive Melodic
- Melodic Funk
- Festival Melodic
- Afro Melodic
- Cinematic Melodic
- Melodic Trance
- Vocal Melodic

## 05 · MIN · MINIMAL

Categoría: ELECTRONIC / CLUB

- Minimal House
- Romanian Minimal / Rominimal
- Dub Minimal
- Minimal Techno
- Minimal Tech House
- Micro Techno
- Minimal / Deep Tech
- Minimal DnB
- Click / Microhouse
- Deep Tech
- Minimal Dub
- Hypnotic Minimal
- Microhouse
- Minimal Electro
- Groovy Minimal

## 06 · ACI · ACID

Categoría: ELECTRONIC / CLUB

- Acid House
- Acid Electro
- Acid Bass
- Acid Techno
- Acid Tekno
- Acid Rave
- Acid Trance
- Acid Hard Techno
- Acid Garage
- Acidcore
- Acid Hard Trance
- Acid Disco
- Acid Breaks
- Acid Psy
- Acid Funk

## 07 · GRO · GROOVE

Categoría: ELECTRONIC / CLUB

- Hardgroove
- Percussive Groove
- Hard Groove House
- Groove Techno
- Groove House
- Rolling Groove
- Groovy Techno
- Funky / Groove House
- Hypnotic Groove
- Funky Techno
- Jackin Groove
- Groove Trance
- Tribal Groove
- Disco Groove
- Latin Groove
- Minimal Groove

## 08 · BOU · BOUNCE

Categoría: ELECTRONIC / CLUB

- Bounce
- Donk
- Bouncy Trance
- Bouncy Techno
- Scouse House / Bouncy House
- Bouncy Hardcore
- Future Bounce
- Bounce House
- Latin Bounce
- Melbourne Bounce
- Bounce Techno
- Festival Bounce
- Hard Bounce
- Bouncy Hard Techno

## 09 · IND · INDUSTRIAL

Categoría: ELECTRONIC / CLUB

- Industrial Techno
- Industrial Trance
- Industrial DnB
- Industrial Hardcore
- Power Noise / Rhythmic Noise
- Industrial Dubstep
- Industrial Dance
- EBM
- Industrial Breaks
- Industrial Bass
- Dark Electro
- Industrial Rave
- Industrial Electro
- Death Industrial
- Industrial Hard Techno

## 10 · TRI · TRIBAL

Categoría: ELECTRONIC / CLUB

- Tribal House
- Guaracha / Tribal Guaracha
- Tribal Bass
- Tribal Techno
- Percussive Tribal
- Tribal Groove
- Tribal Tech House
- Progressive Tribal
- Organic Tribal
- Afro Tribal
- Psy Tribal
- Dark Tribal
- Latin Tribal
- Tribal Trance
- Festival Tribal

## 11 · TRA · TRANCE

Categoría: ELECTRONIC / CLUB

- Acid Trance
- Hypnotic Trance
- Goa Trance
- Balearic Trance
- Progressive Trance
- Nitzhonot
- Classic Trance
- Psytrance
- Full-On Trance
- Deep Trance
- Raw Trance
- Future Trance
- Dream Trance
- Tech Trance
- Festival Trance
- Euro Trance
- Uplifting Trance
- Melodic Trance
- Hard Trance
- Vocal Trance

## 12 · PSY · PSY

Categoría: ELECTRONIC / CLUB

- Psytrance
- Hi-Tech / H-Tech Psy
- Psygressive
- Progressive Psy
- Psy-Techno
- Zenonesque
- Full-On Psy
- Psybient
- Suomisaundi
- Goa Trance
- Psychill
- Night Full-On
- Dark Psytrance
- Psy Dub
- Morning Full-On
- Forest Psy
- Psy Breaks
- Psychedelic Trance
- Psycore
- Psy Bass

## 13 · HDC · HARDCORE

Categoría: ELECTRONIC / CLUB

- Hardcore Techno
- Extratone
- Bouncy Techno
- Gabber
- Happy Hardcore
- Deathchant Hardcore
- Early Hardcore
- UK Hardcore
- Digital Hardcore
- Mainstream Hardcore
- Breakbeat Hardcore
- Crossbreed
- Industrial Hardcore
- Darkcore
- Hardtek / Tekno
- Frenchcore
- Hardcore Breaks
- Neo Rave
- Uptempo Hardcore
- Acidcore
- Rawstyle
- Terrorcore
- Makina
- Speedcore
- Freeform Hardcore

## 14 · DNB · DRUM & BASS

Categoría: ELECTRONIC / CLUB

- Jungle
- Minimal DnB
- Sambass
- Liquid DnB / Liquid Funk
- Atmospheric / Intelligent DnB
- Clownstep
- Neurofunk
- Drumfunk / Choppage
- Crossbreed
- Jump Up
- Halftime / 87
- Skullstep
- Dancefloor DnB
- Autonomic
- Trancestep
- Techstep
- Jazzstep
- Drumstep
- Darkstep
- Ragga Jungle
- Breakcore
- Hardstep
- Darkside Jungle
- Jungle Tekno
- Deep DnB
- Rollers

## 15 · GAR · GARAGE

Categoría: ELECTRONIC / CLUB

- UK Garage
- Garage House
- Vocal Garage
- 2-Step
- UK Funky
- Soulful Garage
- Speed Garage
- 4x4 Garage
- Breakstep
- Bassline
- Niche / Bassline House
- Dubstep Garage
- Future Garage
- Grime-influenced Garage
- Ghetto Garage
- Dark Garage
- Deep Garage
- Old-School Garage

## 16 · BAS · DUBSTEP / BASS

Categoría: ELECTRONIC / CLUB

- Dubstep
- Post-Dubstep
- Wave
- Deep Dubstep
- Purple Sound
- Hardwave
- 140
- Wonky
- Trapstep
- Brostep
- Midtempo Bass
- Drumstep
- Riddim
- Leftfield Bass
- Grime
- Future Riddim
- Experimental Bass
- Juke / Footwork
- Melodic Dubstep
- Glitch Hop
- Jersey Club
- Deathstep
- Bass Music
- Global Club
- Tearout
- UK Bass

## 17 · GUA · GUARACHA

Categoría: ELECTRONIC / LATIN

- Guaracha EDM
- Guaracha House
- Latin Guaracha
- Tribal Guaracha
- Guaracha Tribal
- Festival Guaracha
- Aleteo
- Guaracha Rave
- Colombian Tribal
- Zapateo
- Hard Guaracha
- Circuit / Tribal Guaracha
- Guaracha Tech
- Psy Guaracha

## 18 · AFR · AFRO

Categoría: ELECTRONIC / AFRICAN

- Afro House
- Kwaito
- Afro Funk
- Afro Tech
- Afro Deep
- Organic Afro
- Afro Techno
- Afro Progressive
- Ancestral House
- Afro Melodic
- Afro Tribal
- Afro Soulful
- Afro / Latin House
- Afro Electronic
- Afro Latin
- 3-Step
- Afro Bass
- Gqom
- Afro Disco

## 19 · AMA · AMAPIANO

Categoría: ELECTRONIC / AFRICAN

- Amapiano
- Deep Amapiano
- Piano Hub / Mainstream Amapiano
- Private School Amapiano
- Jazz Amapiano
- Afro Amapiano
- Log Drum Amapiano
- Sgija
- 3-Step
- Vocal Amapiano
- Quantum Sound
- Tech Amapiano
- Soulful Amapiano
- Bacardi House
- Gqom-influenced Amapiano

## 20 · EDM · EDM / MAINSTAGE

Categoría: ELECTRONIC / FESTIVAL

- Big Room
- Festival House
- Festival Trance
- Mainstage
- Festival Techno
- Bass House
- Electro House
- Hands Up
- Slap House
- Festival Progressive House
- Commercial Dance
- Future Bounce
- Future House
- Dance / Pop
- Electro Pop
- Future Rave
- Progressive EDM
- Stadium EDM
- Big Room Techno
- Big Room Trance

## 21 · ELC · ELECTRO

Categoría: ELECTRONIC / CLUB

- Classic Electro
- Electro Bass
- Freestyle Electro
- Detroit Electro
- Electro Breaks
- Ghettotech
- Modern Electro
- Dark Electro
- Breakdance Electro
- Electro-Funk
- Minimal Electro
- Electropop
- Electroclash
- Acid Electro
- Electro-industrial
- Electro House
- Nu Electro
- Electro Techno
- Miami Bass

## 22 · DIS · DISCO

Categoría: DANCE / CLASSICS

- Classic Disco
- Boogie
- Future Funk
- Nu-Disco
- Disco Funk
- Balearic Disco
- Italo Disco
- Disco Soul
- Dark Disco
- Eurodisco
- Latin Disco
- Indie Dance / Disco
- Space Disco
- Disco House
- Afro Disco
- Cosmic Disco
- French House / Filter Disco
- Electro Disco
- Hi-NRG
- Disco Pop
- Psychedelic Disco
- Post-Disco
- Disco Rap
- Disco Edits / Re-Edits

## 23 · TFB · TRAP / FUTURE BASS

Categoría: ELECTRONIC / URBAN

- EDM Trap
- Kawaii Future Bass
- Bass Trap
- Festival Trap
- Chill Trap
- Latin Trap
- Hard Trap
- Wave
- Afro Trap
- Hybrid Trap
- Hardwave
- Phonk / Drift Phonk
- Trapstep
- Future Trap
- Jersey-influenced Trap
- Future Bass
- Melodic Trap
- Glitch Trap

## 24 · REG · REGGAETÓN

Categoría: LATIN / URBAN

- Old-School Reggaetón
- Reggaetón Alternativo
- Latin Urban
- Classic Reggaetón
- Reggaetón Underground
- Dembow
- Modern Reggaetón
- Reggaetón Mexicano
- Malianteo
- Reggaetón Pop
- Colombian Reggaetón
- Playero
- Pop Urbano
- Puerto Rican Reggaetón
- Sandungueo
- Perreo
- Reggaetón House
- Reggaetón 2000s
- Perreo Intenso
- Reggaetón Tech
- Reggaetón 2010s
- Neoperreo
- Reggaetón EDM
- Reggaetón 2020s
- Romantic Reggaetón
- Reggaetón Trap

## 25 · HIP · HIP-HOP

Categoría: URBAN / OPEN FORMAT

- East Coast
- Abstract Hip-Hop
- G-Funk
- West Coast
- Trap
- Crunk
- Southern Hip-Hop
- Drill
- Miami Bass
- Global Hip-Hop
- Jersey Drill
- Phonk
- Boom Bap
- Latin Hip-Hop
- Emo Rap
- Old School Hip-Hop
- UK Hip-Hop
- Party Rap
- Golden Age Hip-Hop
- Grime
- Commercial Hip-Hop
- Gangsta Rap
- Cloud Rap
- Underground Hip-Hop
- Conscious Hip-Hop
- Lo-Fi Hip-Hop
- Alternative Hip-Hop
- Jazz Rap

## 26 · RNB · R&B

Categoría: URBAN / OPEN FORMAT

- Contemporary R&B
- Soul
- Trap Soul
- Classic R&B
- Funk
- Electronic R&B
- 90s R&B
- Quiet Storm
- Dance R&B
- 2000s R&B
- New Jack Swing
- Pop R&B
- Alternative R&B
- Hip-Hop Soul
- Slow Jams
- Progressive R&B
- Afro R&B
- Future R&B
- Neo Soul
- Latin R&B

## 27 · POP · POP / TOP 40

Categoría: MAINSTREAM / OPEN FORMAT

- Pop
- J-Pop
- Urban Pop
- Top 40
- Afropop
- Throwback Pop
- Dance Pop
- Country Pop
- 80s Pop
- Electropop
- Disco Pop
- 90s Pop
- Synth-Pop
- Hyperpop
- 2000s Pop
- Indie Pop
- Teen Pop
- 2010s Pop
- Pop Rock
- Adult Contemporary
- 2020s Pop
- Pop Rap
- Power Pop
- Party Pop
- Latin Pop
- Euro Pop
- Clean Pop
- K-Pop
- Tropical Pop

## 28 · AFB · AFROBEATS

Categoría: AFRICAN / URBAN

- Afrobeats
- Amapiano Crossover
- Ghanaian Afrobeats
- Afropop
- Afro Trap
- Highlife-influenced Afrobeats
- Afro R&B
- Afro Drill
- Afro Soul
- Afro-Fusion
- Afro Hip-Hop
- Afro Gospel
- Afro Swing
- Afro Dancehall
- Afro Urban
- Afro Bashment
- Afro Pop
- Alte
- Naija Pop

## 29 · CAR · REGGAE / DANCEHALL

Categoría: CARIBBEAN / OPEN FORMAT

- Reggae
- Digital Dancehall
- Reggae Pop
- Roots Reggae
- Lovers Rock
- Dub Poetry
- Dub
- Soca
- Trap Dancehall
- Dancehall
- Calypso
- Afro Dancehall
- Old-School Dancehall
- Ska
- Latin Dancehall
- Modern Dancehall
- Rocksteady
- Caribbean Bass
- Ragga
- Reggae Fusion
- Ragga Jungle

## 30 · BRF · BRAZILIAN FUNK

Categoría: BRAZIL / URBAN

- Funk Carioca
- Funk Ostentação
- Funk Rave
- Baile Funk
- Funk Melody
- Brazilian Bass Funk
- Mandelao Funk
- Rasteirinha
- Phonk Brasileiro
- BH Funk
- Brega Funk
- Mega Funk
- Melodic Funk
- Funk 150 BPM
- Funk MTG
- Eletrofunk
- Funk 170 BPM
- Funk Automotivo
- Funk Proibidão

## 31 · LAT · LATIN / TROPICAL

Categoría: LATIN / OPEN FORMAT

- Salsa
- Champeta
- Música Popular Colombiana
- Salsa Dura
- Soca
- Tropical
- Salsa Romántica
- Mambo
- Tropical Urbano
- Merengue
- Latin Dance
- Electrocumbia
- Bachata
- Latin Pop
- Moombahton
- Cumbia
- Latin House
- Salsa Choke
- Cumbia Sonidera
- Latin Hip-Hop
- Merenhouse
- Cumbia Villera
- Dembow
- Latin Disco
- Vallenato
- Regional Mexican

## 32 · ROC · ROCK

Categoría: ROCK / OPEN FORMAT

- Classic Rock
- Post-Punk
- Latin Rock
- Alternative Rock
- New Wave
- Dance-Rock
- Indie Rock
- Grunge
- Electronic Rock
- Hard Rock
- Metal
- Industrial Rock
- Garage Rock
- Heavy Metal
- Gothic Rock
- Psychedelic Rock
- Glam Rock
- Emo
- Progressive Rock
- Glam Metal
- Post-Rock
- Pop Rock
- Britpop
- Shoegaze
- Punk Rock
- Surf Rock
- Rock en Español
- Pop Punk
- Southern Rock
- Yacht Rock

## 33 · FUN · FUNK / SOUL

Categoría: DANCE / CLASSICS

- Funk
- Latin Funk
- Southern Soul
- Classic Funk
- Disco Funk
- Philly Soul
- P-Funk
- Jazz-Funk
- Neo Soul
- Deep Funk
- Future Funk
- Psychedelic Soul
- Electro-Funk
- Soul
- Motown
- Boogie
- Classic Soul
- Rare Groove
- G-Funk
- Deep Soul
- Funk / Soul Edits
- Afro-Funk
- Northern Soul

## 34 · CTY · COUNTRY

Categoría: OPEN FORMAT / US

- Country
- Outlaw Country
- Country Rap / Hick-Hop
- Classic Country
- Americana
- Country EDM / YEEDM
- Contemporary Country
- Bluegrass
- Line Dance Country
- Country Pop
- Bro-Country
- 90s Country
- Country Rock
- Neo-Traditional Country
- 2000s Country
- Country Dance
- Alt-Country
- Modern Country
- Honky-Tonk
- Western Swing

---

## Cross-tags

Van fuera del género y se reusan en toda la plataforma. No se infiere un branch padre desde uno de estos.

### DJ TYPE

Clave interna: `dj_type`

- Specialist
- Open Format / Crossover
- Multi-Genre
- Selector / Curator
- Turntablist
- Live / Hybrid DJ

### ERA

Clave interna: `era`

- 70s
- 80s
- 90s
- 2000s
- 2010s
- 2020s
- Old School
- Classic
- Current / New Music
- Throwbacks

### CONTEXT

Clave interna: `contexto`

- Club
- Underground
- Warehouse
- Festival
- Rooftop
- Open Air
- Afterhours
- House Party
- Wedding / Private Event
- Corporate
- Radio / Broadcast

### FORMAT / PERFORMANCE

Clave interna: `formato`

- Vinyl
- Digital
- CDJ
- Controller
- Live Remixing
- Live PA Hybrid
- Scratching
- Open Format Mixing
- Extended Sets
- B2B

### ENERGY / MOOD

Clave interna: `energia`

- Warm-Up
- Peak-Time
- Closing
- Deep
- Dark
- Hypnotic
- Groovy
- Melodic
- Hard
- Fast
- Emotional
- Commercial
- Experimental
