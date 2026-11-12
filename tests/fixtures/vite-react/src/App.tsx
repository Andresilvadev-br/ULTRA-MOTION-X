import { useState } from "react";

export default function App() {
  const [open, setOpen] = useState(false);
  const items = ["Alpha", "Beta", "Gamma"];
  return (
    <main>
      <nav>
        <a href="#a">Home</a>
      </nav>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <div className="card product-card">Card</div>
      <ul>
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
      {open && (
        <div role="dialog" className="modal">
          Dialog
        </div>
      )}
      <div className="toast">Saved</div>
      <form>
        <input name="email" />
      </form>
    </main>
  );
}
