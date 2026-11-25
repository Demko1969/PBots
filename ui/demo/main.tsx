import { createRoot } from "react-dom/client";
import { Workspace } from "../app/page";
import robots from "../public/planning-bots.svg?raw";
import { scenario } from "./scenario";
import "../app/globals.css";
import "./style.css";

createRoot(document.getElementById("root")!).render(<>
  <div className="demo-robot-sprite" aria-hidden="true" dangerouslySetInnerHTML={{ __html: robots }} />
  <Workspace demo={scenario} />
</>);
