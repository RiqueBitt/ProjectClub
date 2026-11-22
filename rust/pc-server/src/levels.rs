//! Níveis da conta e baús — lidos direto dos catálogos do Node
//! (`server/src/data/levelsCatalog.js` e `chestsCatalog.js`), pra nunca
//! ficarem diferentes do que o Node usa.

use std::sync::LazyLock;

/// Um nível de `LEVELS`.
#[derive(Clone, Debug, PartialEq)]
pub struct Level {
    pub level: i64,
    pub name: String,
    pub min_xp: i64,
}

const LEVELS_JS: &str = include_str!("../../../server/src/data/levelsCatalog.js");
const CHESTS_JS: &str = include_str!("../../../server/src/data/chestsCatalog.js");

/// `LEVELS` (em ordem de nível).
pub static LEVELS: LazyLock<Vec<Level>> = LazyLock::new(|| {
    let re =
        regex::Regex::new(r#"\{\s*level:\s*(\d+),\s*name:\s*["']([^"']*)["'],\s*minXp:\s*(\d+)"#)
            .expect("regex");
    re.captures_iter(LEVELS_JS)
        .filter_map(|c| {
            Some(Level {
                level: c[1].parse().ok()?,
                name: c[2].to_string(),
                min_xp: c[3].parse().ok()?,
            })
        })
        .collect()
});

/// `LEVEL_TITLES` (nível mínimo → título).
static TITLES: LazyLock<Vec<(i64, String)>> = LazyLock::new(|| {
    let re = regex::Regex::new(r#"\{\s*minLevel:\s*(\d+),\s*title:\s*["']([^"']*)["']\s*\}"#)
        .expect("regex");
    re.captures_iter(LEVELS_JS)
        .filter_map(|c| Some((c[1].parse().ok()?, c[2].to_string())))
        .collect()
});

/// `MEGA_CHEST_STREAK_REQUIRED` do `chestsCatalog.js`.
pub static MEGA_CHEST_STREAK_REQUIRED: LazyLock<i64> = LazyLock::new(|| {
    regex::Regex::new(r"MEGA_CHEST_STREAK_REQUIRED\s*=\s*(\d+)")
        .expect("regex")
        .captures(CHESTS_JS)
        .and_then(|c| c[1].parse().ok())
        .unwrap_or(5)
});

/// `LEVELS.find((l) => l.level === level) || LEVELS[0]`.
pub fn current(level: i64) -> Option<&'static Level> {
    LEVELS.iter().find(|l| l.level == level).or(LEVELS.first())
}

/// `nextLevel(level)`.
pub fn next(level: i64) -> Option<&'static Level> {
    LEVELS.iter().find(|l| l.level == level + 1)
}

/// `titleForLevel(level)`.
pub fn title_for(level: i64) -> String {
    let mut out = TITLES.first().map(|t| t.1.clone()).unwrap_or_default();
    for (min, title) in TITLES.iter() {
        if level >= *min {
            out = title.clone();
        } else {
            break;
        }
    }
    out
}

/// Quanto (0–100) do nível atual já foi (100 no nível máximo).
pub fn progress(level: i64, xp: i64) -> i64 {
    let cur = current(level).map(|l| l.min_xp).unwrap_or(0);
    let Some(n) = next(level) else {
        return 100;
    };
    let in_level = (xp - cur) as f64;
    let needed = (n.min_xp - cur) as f64;
    ((in_level / needed) * 100.0).floor().clamp(0.0, 100.0) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogos_lidos_do_node() {
        assert!(LEVELS.len() >= 40, "{}", LEVELS.len());
        assert_eq!(
            LEVELS[1],
            Level {
                level: 2,
                name: "Lv.2".into(),
                min_xp: 556
            }
        );
        assert_eq!(progress(1, 278), 50);
        assert_eq!(progress(1, -5), 0);
        assert_eq!(progress(LEVELS.last().unwrap().level, 0), 100);
        assert_eq!(title_for(1), "Novato");
        assert_eq!(title_for(9), "Novato");
        assert_eq!(title_for(10), "Iniciante");
        assert_eq!(title_for(0), "Novato");
        assert_eq!(title_for(250), "Supremo");
        assert_eq!(*MEGA_CHEST_STREAK_REQUIRED, 5);
    }
}
