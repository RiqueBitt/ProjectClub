"""Receita do modelo de cada carta (a chave é o `slug` da carta no banco).

Só criaturas ORIGINAIS do Project Club. Cartas que homenageiam personagens
de outras marcas não têm receita aqui: no jogo elas usam o espírito
elemental do elemento delas (ver ELEMENTALS).
"""

# Paleta por elemento (cor principal, clara, escura, brilho)
PAL = {
    "FOGO": ("#e8502a", "#ffb347", "#8f2414", "#ffd23c"),
    "AGUA": ("#2f8fe0", "#9bdcff", "#17508f", "#7fe3ff"),
    "TERRA": ("#6fa84a", "#c9d78a", "#5b4630", "#b6e36a"),
    "AR": ("#bfe6f5", "#ffffff", "#6c9fc4", "#e9fbff"),
    "LUZ": ("#ffd65a", "#fff6c8", "#c98a1e", "#fff2a0"),
    "SOMBRA": ("#6a4bb3", "#b79cf0", "#2a1b4d", "#c58bff"),
}

R = {}

# ---------------------------------------------------------------- FOGO
R["faisca"] = dict(kind="blob", h=0.62, body="#ff8a2a", belly="#ffd27a", top="flame", glow="#ff5a14", glow_strength=0.5)
R["lobo-brasa"] = dict(kind="quad", h=0.95, body="#5a3a36", skin="#6b4640", snout="#e9c9a8", tail="flame", back_flame=True, angry=True, eye_glow="#ffb020", feet="#2b1b1a")
R["guarda-forja"] = dict(kind="biped", h=1.15, heavy=True, body="#6b4a3a", belly="#3a3a44", skin="#c98a5a", hat="helmet", hat_color="#8b8f9a", accent="#ff5a14", weapon="hammer", offhand="shield", belt="#2b2b33", feet="#2b2b33")
R["alquimista-chama"] = dict(kind="biped", h=0.95, body="#7a2f2f", belly="#f1d9a7", skin="#f0c39a", hat="wizard", hat_color="#b83a2a", weapon="flask", accent="#ff7a1f", cape="#4a1c1c", feet="#3a1a14")
R["fenix-rubra"] = dict(kind="flyer", h=1.15, span=1.25, body="#e23b2a", belly="#ffb347", wings="#ff7a1f", beak="#ffd23c", crest="#ffd23c", tail="flame", glow="#ff3d00", glow_strength=0.35)
R["titan-vulcao"] = dict(kind="biped", h=1.55, heavy=True, body="#3b2a2a", belly="#ff6a1a", skin="#4a3434", rocks="#2b1f1f", horns="#ff8a2a", horn_size=1.3, angry=True, eye_glow="#ffd23c", hat="flame", feet="#1f1515", limb="#3b2a2a")

# ---------------------------------------------------------------- ÁGUA
R["girino-bolha"] = dict(kind="blob", h=0.62, body="#5ab8f0", belly="#d5f2ff", top="drop", fins="#2f8fe0", rough=0.25)
R["curandeira-mare"] = dict(kind="biped", h=0.95, body="#2f8fe0", belly="#d5f2ff", skin="#bfe8ff", hat="hood", hat_color="#17508f", weapon="staff", accent="#7fe3ff", cape="#17508f", feet="#17508f")
R["tartaruga-coral"] = dict(kind="quad", h=1.05, fat=1.15, body="#4fae9b", skin="#6fd0b6", snout="#6fd0b6", shell="#b0553f", shell_detail="#ff8fb1", ears=None, tail="stub", feet="#2e6e62")
R["oraculo-abissal"] = dict(kind="biped", h=1.0, body="#1e3f7a", belly="#2f8fe0", skin="#7fb8e6", hat="crystal", accent="#7fe3ff", weapon="staff", cape="#122a52", eye_glow="#9ff3ff", feet="#122a52")
R["serpente-gelo"] = dict(kind="serpent", h=1.1, body="#7fd0f0", belly="#e3f8ff", frost="#c9f4ff", fins="#2f8fe0", fangs=True, eye_glow="#e9fbff")
R["leviata"] = dict(kind="serpent", h=1.6, thick=1.3, body="#17508f", belly="#7fd0f0", spikes="#0e2f5a", horns="#e3f8ff", fins="#2f8fe0", fangs=True, head_size=1.2, eye_glow="#7fe3ff")

# ---------------------------------------------------------------- TERRA
R["broto-pedra"] = dict(kind="blob", h=0.6, body="#9a9484", belly="#c9c3b0", top="sprout", rough=0.95, squat=0.9)
R["javali-musgo"] = dict(kind="quad", h=1.0, fat=1.15, body="#7a5a3a", skin="#8a6844", snout="#d9b48a", tusks=True, moss="#5aa33a", ears="pointy", tail="thin", angry=True, feet="#3a2a1a")
R["golem-argila"] = dict(kind="biped", h=1.2, heavy=True, body="#b0784a", belly="#c98d5c", skin="#b0784a", rocks="#8a5a34", eye_glow="#b6e36a", hat="leaf", feet="#7a5030", head_size=0.85)
R["druida-raiz"] = dict(kind="biped", h=1.0, body="#3f7a3a", belly="#c9d78a", skin="#e2c79a", hat="hood", hat_color="#2e5a2a", horns="#8a5a34", horn_size=1.2, weapon="staff", accent="#b6e36a", cape="#2e5a2a", feet="#5b4630")
R["colosso-jade"] = dict(kind="biped", h=1.5, heavy=True, body="#3fae7a", belly="#7fe0b0", skin="#3fae7a", rocks="#2a7a55", hat="crystal", accent="#9ff3c8", eye_glow="#e9fff2", feet="#1f5a40", head_size=0.8)
R["mae-montanha"] = dict(kind="biped", h=1.55, heavy=True, body="#6a6f5a", belly="#8fae6a", skin="#9aa08a", rocks="#f2f6fa", hat="leaf", horns="#f2f6fa", horn_size=0.8, feet="#4a4e3e", head_size=0.9, cape="#5aa33a")

# ---------------------------------------------------------------- AR
R["pardal-vento"] = dict(kind="flyer", h=0.65, body="#b98a5a", belly="#f2e2c8", wings="#8a6844", beak="#f2a23a", head_size=1.2)
R["arqueira-nuvem"] = dict(kind="biped", h=0.95, body="#7fb8e6", belly="#ffffff", skin="#f3d2b0", hat="hood", hat_color="#e9f6ff", weapon="bow", cape="#bfe6f5", feet="#6c9fc4", ears="pointy")
R["falcao-tempestade"] = dict(kind="flyer", h=1.0, span=1.2, body="#4a5a7a", belly="#dfe9f5", wings="#33415c", beak="#ffd23c", crest="#ffd23c", angry=True, eye_glow="#ffe680")
R["monge-brisa"] = dict(kind="biped", h=0.95, body="#f2a23a", belly="#fff1d6", skin="#f0c39a", belt="#c9562a", feet="#8a5a34", hat="halo", cape="#ffd98a")
R["dragao-ciclone"] = dict(kind="flyer", h=1.4, span=1.3, body="#7fc8d8", belly="#e9fbff", wings="#4a9ab0", snout="#7fc8d8", horns="#ffffff", bat=True, tail="long", angry=True, eye_glow="#e9fbff", head_size=1.15)
R["rainha-ceus"] = dict(kind="biped", h=1.2, body="#e9f6ff", belly="#ffffff", skin="#f3d2b0", hat="crown", wings="#ffffff", weapon="staff", accent="#ffe680", cape="#7fb8e6", feet="#6c9fc4")

# ---------------------------------------------------------------- LUZ
R["vagalume"] = dict(kind="blob", h=0.55, body="#3a3a44", belly="#ffe680", top="antenna", accent="#ffe680", wings="#e9fbff", wing_alpha=0.6, glow=None)
R["escudeiro-sol"] = dict(kind="biped", h=1.0, body="#e9c46a", belly="#fff6c8", skin="#f0c39a", hat="helmet", hat_color="#f2c23a", accent="#e2572a", weapon="sword", offhand="shield", feet="#8a5a34")
R["cleriga-aurora"] = dict(kind="biped", h=0.98, body="#fff1d6", belly="#ffd65a", skin="#e8b98f", hat="halo", weapon="staff", accent="#fff2a0", cape="#ffb86b", feet="#c98a1e")
R["paladino-prisma"] = dict(kind="biped", h=1.2, heavy=True, body="#dfe6f2", belly="#9bdcff", skin="#f0c39a", hat="helmet", hat_color="#eef3fa", accent="#c58bff", weapon="sword", weapon_size=1.2, offhand="shield", cape="#ff8fb1", feet="#8b93a6")
R["arcanjo"] = dict(kind="biped", h=1.25, body="#fff6c8", belly="#ffffff", skin="#f3d2b0", hat="halo", wings="#fffbe6", weapon="sword", accent="#ffd65a", cape="#ffd65a", feet="#c98a1e", eye_glow="#fff2a0")
R["estrela-primordial"] = dict(kind="blob", h=1.35, body="#fff2a0", belly="#ffffff", top="halo", glow="#ffd65a", glow_strength=1.6, eye_glow="#ffffff", wings="#fffbe6")

# ---------------------------------------------------------------- SOMBRA
R["morcego-eco"] = dict(kind="flyer", h=0.7, body="#4a3a6a", belly="#7a62a8", wings="#2a1b4d", bat=True, ears=True, snout="#7a62a8", tail=None, head_size=1.25)
R["ladino-nevoa"] = dict(kind="biped", h=0.95, body="#3a3352", belly="#5a5078", skin="#cdb7a0", hat="hood", hat_color="#2a2440", weapon="dagger", offhand="dagger", cape="#2a2440", feet="#1b1420", angry=True)
R["aranha-sombria"] = dict(kind="blob", h=0.7, body="#2a1b4d", belly="#6a4bb3", top="ears", angry=True, eye_glow="#ff4f6d", squat=0.85)
R["bruxa-lua"] = dict(kind="biped", h=1.0, body="#3a2466", belly="#6a4bb3", skin="#b9e0a8", hat="wizard", hat_color="#2a1b4d", weapon="staff", accent="#c58bff", cape="#2a1b4d", feet="#1b1420")
R["cavaleiro-eclipse"] = dict(kind="biped", h=1.25, heavy=True, body="#2b2440", belly="#4a3a6a", skin="#2b2440", hat="helmet", hat_color="#3a3352", accent="#c58bff", weapon="sword", weapon_size=1.25, cape="#6a1f3a", eye_glow="#ff4f6d", feet="#151020")
R["rei-abismo"] = dict(kind="biped", h=1.5, heavy=True, body="#1f1533", belly="#3a2466", skin="#3a2a55", hat="crown", horns="#c58bff", horn_size=1.4, weapon="staff", weapon_size=1.2, accent="#c58bff", cape="#3a0f2a", eye_glow="#c58bff", angry=True, feet="#0e0a18")

# Espírito elemental de cada elemento: usado por recrutas/fichas e pelas
# cartas sem modelo próprio.
ELEMENTALS = {
    "FOGO": dict(kind="blob", h=0.75, body="#ff7a1f", belly="#ffd27a", top="flame", glow="#ff5a14", glow_strength=0.6, eye_glow="#fff2a0"),
    "AGUA": dict(kind="blob", h=0.75, body="#3aa0ff", belly="#c9f0ff", top="drop", rough=0.2, fins="#17508f"),
    "TERRA": dict(kind="blob", h=0.75, body="#8a7a5a", belly="#b6a47a", top="rock", accent="#6f6a5c", rough=0.95, squat=0.9),
    "AR": dict(kind="blob", h=0.75, body="#e9fbff", belly="#ffffff", top="tuft", accent="#bfe6f5", wings="#ffffff", wing_alpha=0.7),
    "LUZ": dict(kind="blob", h=0.75, body="#ffe680", belly="#ffffff", top="halo", glow="#ffd65a", glow_strength=0.9),
    "SOMBRA": dict(kind="blob", h=0.75, body="#4a2f8a", belly="#8a6ad0", top="ears", eye_glow="#c58bff", angry=True),
}
