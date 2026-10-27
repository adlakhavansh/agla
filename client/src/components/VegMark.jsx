// The FSSAI marks every Indian menu carries: a green dot for veg, a brown triangle for non-veg.
export default function VegMark({ veg }) {
  return (
    <span className={`vegmark ${veg ? "veg" : "nonveg"}`} role="img" aria-label={veg ? "Vegetarian" : "Non-vegetarian"}>
      {veg ? <i /> : <b />}
    </span>
  );
}
