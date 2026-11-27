// Option pricing used to read implied volatility and delta off quoted prices. Pure.
//
// Black's 1976 model on the forward: the forward and the discount factor carry the rate, the
// dividends and the borrow cost, so no dividend estimate is needed. The forward of an expiry is read
// from its own quotes by put-call parity at the strike where call and put are closest in price
// (`parityForward`), the method Cboe's VIX white paper uses for the same purpose.
//
// Listed stock options are American. Near and out of the money the early-exercise premium is small,
// and every figure the app shows is read there (at-the-money pairs, 25-delta wings).

/** Standard normal cumulative distribution (Graeme West's double-precision form of Hart's algorithm). */
export function normCdf(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  const a = Math.abs(x);
  let c: number;
  if (a > 37) c = 0;
  else {
    const e = Math.exp(-(a * a) / 2);
    if (a < 7.07106781186547) {
      let n = 3.52624965998911e-2 * a + 0.700383064443688;
      n = n * a + 6.37396220353165;
      n = n * a + 33.912866078383;
      n = n * a + 112.079291497871;
      n = n * a + 221.213596169931;
      n = n * a + 220.206867912376;
      let d = 8.83883476483184e-2 * a + 1.75566716318264;
      d = d * a + 16.064177579207;
      d = d * a + 86.7807322029461;
      d = d * a + 296.564248779674;
      d = d * a + 637.333633378831;
      d = d * a + 793.826512519948;
      d = d * a + 440.413735824752;
      c = (e * n) / d;
    } else {
      let b = a + 0.65;
      b = a + 4 / b;
      b = a + 3 / b;
      b = a + 2 / b;
      b = a + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}

export type Right = "C" | "P";

const d1 = (f: number, k: number, t: number, vol: number) => (Math.log(f / k) + (vol * vol * t) / 2) / (vol * Math.sqrt(t));

/** Black-76 price of a European call or put on a forward `f`, strike `k`, `t` years, discount factor `df`. */
export function black76(right: Right, f: number, k: number, t: number, vol: number, df: number): number {
  const a = d1(f, k, t, vol);
  const b = a - vol * Math.sqrt(t);
  return right === "C" ? df * (f * normCdf(a) - k * normCdf(b)) : df * (k * normCdf(-b) - f * normCdf(-a));
}

/** Forward delta: N(d1) for a call, N(d1) − 1 for a put. */
export function forwardDelta(right: Right, f: number, k: number, t: number, vol: number): number {
  const n = normCdf(d1(f, k, t, vol));
  return right === "C" ? n : n - 1;
}

const VOL_LO = 0.005;
const VOL_HI = 8;

/**
 * The volatility at which Black-76 gives `price`, or null when no volatility can: a price at or
 * below the option's discounted intrinsic value, or above what an 800% volatility prices.
 */
export function impliedVol(right: Right, price: number, f: number, k: number, t: number, df: number): number | null {
  if (!(price > 0) || !(f > 0) || !(k > 0) || !(t > 0) || !(df > 0)) return null;
  const intrinsic = df * Math.max(0, right === "C" ? f - k : k - f);
  if (price <= intrinsic) return null;
  let lo = VOL_LO;
  let hi = VOL_HI;
  if (black76(right, f, k, t, lo, df) > price || black76(right, f, k, t, hi, df) < price) return null;
  // the price rises with volatility, so bisection always closes in; 60 halvings reach double precision
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (black76(right, f, k, t, mid, df) < price) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Forward implied by put-call parity at one strike: F = K + (call − put) ÷ discount factor.
 * Read at the strike where the two prices are closest, where the early-exercise premium is smallest.
 */
export const parityForward = (k: number, call: number, put: number, df: number) => k + (call - put) / df;

/**
 * Volatility over a constant number of days from two expiries either side of it: total variance
 * (vol² × days) is taken as linear in time between them. Both expiries must bracket `days`.
 */
export function varianceInterpolate(lo: { d: number; iv: number }, hi: { d: number; iv: number }, days: number): number | null {
  if (!(lo.d > 0) || !(hi.d > lo.d) || days < lo.d || days > hi.d) return null;
  const w = (days - lo.d) / (hi.d - lo.d);
  const total = (1 - w) * lo.iv * lo.iv * lo.d + w * hi.iv * hi.iv * hi.d;
  return total > 0 ? Math.sqrt(total / days) : null;
}
