//! Colour handling: sRGB ⇄ linear ⇄ OKLab. Interpolating in OKLab avoids the muddy
//! mid-points of naive sRGB interpolation.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rgba {
    /// sRGB components in [0, 1].
    pub r: f64,
    pub g: f64,
    pub b: f64,
    pub a: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Oklab {
    pub l: f64,
    pub a: f64,
    pub b: f64,
    pub alpha: f64,
}

fn to_linear(c: f64) -> f64 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        libm::pow((c + 0.055) / 1.055, 2.4)
    }
}

fn to_srgb(c: f64) -> f64 {
    if c <= 0.003_130_8 {
        c * 12.92
    } else {
        1.055 * libm::pow(c, 1.0 / 2.4) - 0.055
    }
}

impl Rgba {
    pub fn to_oklab(self) -> Oklab {
        let (r, g, b) = (to_linear(self.r), to_linear(self.g), to_linear(self.b));
        let l = 0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b;
        let m = 0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b;
        let s = 0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b;
        let (l, m, s) = (libm::cbrt(l), libm::cbrt(m), libm::cbrt(s));
        Oklab {
            l: 0.210_454_255_3 * l + 0.793_617_785_0 * m - 0.004_072_046_8 * s,
            a: 1.977_998_495_1 * l - 2.428_592_205_0 * m + 0.450_593_709_9 * s,
            b: 0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766_0 * s,
            alpha: self.a,
        }
    }

    /// Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`.
    pub fn from_hex(hex: &str) -> Option<Rgba> {
        let h = hex.strip_prefix('#')?;
        let expand = |s: &str| -> Option<Vec<u8>> {
            match s.len() {
                3 | 4 => s.chars().map(|c| u8::from_str_radix(&format!("{c}{c}"), 16).ok()).collect(),
                6 | 8 => (0..s.len()).step_by(2).map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok()).collect(),
                _ => None,
            }
        };
        let v = expand(h)?;
        let a = if v.len() == 4 { f64::from(v[3]) / 255.0 } else { 1.0 };
        Some(Rgba { r: f64::from(v[0]) / 255.0, g: f64::from(v[1]) / 255.0, b: f64::from(v[2]) / 255.0, a })
    }

    pub fn to_hex(self) -> String {
        let c = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        if self.a >= 1.0 {
            format!("#{:02x}{:02x}{:02x}", c(self.r), c(self.g), c(self.b))
        } else {
            format!("#{:02x}{:02x}{:02x}{:02x}", c(self.r), c(self.g), c(self.b), c(self.a))
        }
    }
}

impl Oklab {
    pub fn to_rgba(self) -> Rgba {
        let l = self.l + 0.396_337_777_4 * self.a + 0.215_803_757_3 * self.b;
        let m = self.l - 0.105_561_345_8 * self.a - 0.063_854_172_8 * self.b;
        let s = self.l - 0.089_484_177_5 * self.a - 1.291_485_548_0 * self.b;
        let (l, m, s) = (l * l * l, m * m * m, s * s * s);
        let r = 4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s;
        let g = -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s;
        let b = -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701_0 * s;
        Rgba {
            r: to_srgb(r).clamp(0.0, 1.0),
            g: to_srgb(g).clamp(0.0, 1.0),
            b: to_srgb(b).clamp(0.0, 1.0),
            a: self.alpha.clamp(0.0, 1.0),
        }
    }
}

/// Interpolates two colours in OKLab.
pub fn mix(a: Rgba, b: Rgba, t: f64) -> Rgba {
    let (x, y) = (a.to_oklab(), b.to_oklab());
    Oklab {
        l: x.l + (y.l - x.l) * t,
        a: x.a + (y.a - x.a) * t,
        b: x.b + (y.b - x.b) * t,
        alpha: x.alpha + (y.alpha - x.alpha) * t,
    }
    .to_rgba()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        for hex in ["#ff0000", "#00ff00", "#0000ff", "#123456", "#ffffff", "#000000", "#7f7f7f"] {
            let c = Rgba::from_hex(hex).unwrap();
            assert_eq!(c.to_oklab().to_rgba().to_hex(), hex);
        }
    }

    #[test]
    fn white_is_l1() {
        let w = Rgba::from_hex("#fff").unwrap().to_oklab();
        assert!((w.l - 1.0).abs() < 1e-4 && w.a.abs() < 1e-4 && w.b.abs() < 1e-4);
    }

    #[test]
    fn mix_endpoints() {
        let a = Rgba::from_hex("#ff0000").unwrap();
        let b = Rgba::from_hex("#0000ff80").unwrap();
        assert_eq!(mix(a, b, 0.0).to_hex(), "#ff0000");
        assert_eq!(mix(a, b, 1.0).to_hex(), "#0000ff80");
        assert!(Rgba::from_hex("#zzz").is_none());
    }
}
