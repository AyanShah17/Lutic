"use client";

import { useState, type FormEvent } from "react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Select } from "./ui/select";

interface AssetCreateFormProps {
  plants: Array<{ id: string; name: string }>;
  lines: Array<{ id: string; name: string; plantId: string }>;
  onCreated: (name: string) => void;
}

export function AssetCreateForm({ plants, lines, onCreated }: AssetCreateFormProps) {
  const [type, setType] = useState<"line" | "machine">("line");
  const [plantId, setPlantId] = useState(plants[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const plantLines = lines.filter((line) => line.plantId === plantId);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/admin/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values)
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => null);
        setError(problem?.detail ?? "Asset creation failed.");
        return;
      }
      const { asset } = await response.json() as { asset: { name: string } };
      onCreated(asset.name);
    } catch {
      setError("Unable to reach Lutic. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="h-fit p-4">
      <form onSubmit={create} className="space-y-3">
        <h2 className="text-sm font-semibold">Add Asset</h2>
        {plants.length === 0 ? (
          <p className="text-xs text-muted-foreground">Your account needs a plant assignment to add assets.</p>
        ) : (
          <>
            <label className="block space-y-1 text-xs">
              <span>Plant</span>
              <Select className="w-full" name="plantId" value={plantId} onChange={(event) => setPlantId(event.target.value)}>
                {plants.map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}
              </Select>
            </label>
            <label className="block space-y-1 text-xs">
              <span>Asset type</span>
              <Select className="w-full" name="type" value={type} onChange={(event) => setType(event.target.value === "machine" ? "machine" : "line")}>
                <option value="line">Production line</option>
                <option value="machine">Machine</option>
              </Select>
            </label>
            <label className="block space-y-1 text-xs">
              <span>Name</span>
              <Input name="name" required minLength={2} maxLength={160} />
            </label>
            {type === "machine" && (
              <>
                <label className="block space-y-1 text-xs">
                  <span>Production line</span>
                  <Select className="w-full" key={plantId} name="parentId" required defaultValue="">
                    <option value="" disabled>{plantLines.length ? "Select a production line" : "Add a production line to this plant first"}</option>
                    {plantLines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
                  </Select>
                </label>
                <label className="block space-y-1 text-xs">
                  <span>Machine type</span>
                  <Input name="machineType" maxLength={120} />
                </label>
                <label className="block space-y-1 text-xs">
                  <span>Manufacturer</span>
                  <Input name="manufacturer" maxLength={120} />
                </label>
                <label className="block space-y-1 text-xs">
                  <span>Model</span>
                  <Input name="model" maxLength={120} />
                </label>
                <label className="block space-y-1 text-xs">
                  <span>Criticality</span>
                  <Select className="w-full" name="criticality" defaultValue="B">
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                  </Select>
                </label>
              </>
            )}
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={pending || (type === "machine" && !plantLines.length)}>
              {pending ? "Adding asset…" : "Add asset"}
            </Button>
          </>
        )}
      </form>
    </Card>
  );
}
