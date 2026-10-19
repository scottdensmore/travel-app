import React from "react";
import TravelGuideForm from "../../../components/ui/travelGuideForm";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import AdminGuidesListClient from "@/components/admin/AdminGuidesListClient";

export const dynamic = 'force-dynamic';

export default async function AdminTravelGuidePage() {
  const guides = await prisma.cityGuide.findMany({
    orderBy: { city: 'asc' }
  });

  return (
    <div className="page-container admin p-8" style={{ marginTop: '100px' }}>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Manage City Guides</h1>
        <Link href="/admin" className="text-blue-600 hover:underline">← Back to Dashboard</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="content">
          <TravelGuideForm />
        </div>

        <div>
          <h2 className="text-2xl font-bold mb-4">Existing Guides</h2>
          <AdminGuidesListClient guides={guides} />
        </div>
      </div>
    </div>
  );
}
