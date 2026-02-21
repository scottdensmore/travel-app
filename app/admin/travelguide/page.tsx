import React from "react";
import TravelGuideForm from "../../../components/ui/travelGuideForm";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import DeleteGuideButton from "./DeleteGuideButton";

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
          <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200 text-left">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">City</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Country</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {guides.map(guide => (
                  <tr key={guide.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{guide.city}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{guide.country}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <DeleteGuideButton id={guide.id} />
                    </td>
                  </tr>
                ))}
                {guides.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-6 py-4 text-center text-sm text-gray-500">No guides found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
