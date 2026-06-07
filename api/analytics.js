/**
 * GET /api/analytics
 *
 * Returns call stats and event data for the dashboard.
 * Query params:
 *   - projectId: filter by project (optional)
 *   - days: number of days to look back (default 30)
 */

import supabase from '../lib/supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const days = parseInt(req.query.days || '30', 10)
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    // Total unique calls
    const { count: totalCalls } = await supabase
      .from('call_events')
      .select('call_sid', { count: 'exact', head: true })
      .gte('created_at', since)

    // Unique callers (unique call SIDs)
    const { data: uniqueCallData } = await supabase
      .from('call_events')
      .select('call_sid')
      .gte('created_at', since)

    const uniqueCallers = new Set(uniqueCallData?.map((e) => e.call_sid) || []).size

    // Most visited nodes
    const { data: nodeVisits } = await supabase
      .from('call_events')
      .select('node_id')
      .gte('created_at', since)
      .not('node_id', 'is', null)

    const nodeCounts = {}
    nodeVisits?.forEach(({ node_id }) => {
      nodeCounts[node_id] = (nodeCounts[node_id] || 0) + 1
    })

    const topNodes = Object.entries(nodeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([nodeId, count]) => ({ nodeId, count }))

    // Recent voicemails
    const { data: voicemails } = await supabase
      .from('voicemails')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20)

    // Calls per day
    const { data: callsByDay } = await supabase
      .from('call_events')
      .select('created_at, call_sid')
      .gte('created_at', since)
      .order('created_at', { ascending: true })

    const dailyCounts = {}
    callsByDay?.forEach(({ created_at, call_sid }) => {
      const day = created_at.split('T')[0]
      if (!dailyCounts[day]) dailyCounts[day] = new Set()
      dailyCounts[day].add(call_sid)
    })

    const callsPerDay = Object.entries(dailyCounts).map(([date, sids]) => ({
      date,
      calls: sids.size,
    }))

    return res.status(200).json({
      totalCalls,
      uniqueCallers,
      topNodes,
      voicemails: voicemails || [],
      callsPerDay,
    })
  } catch (err) {
    console.error('Analytics error:', err)
    return res.status(500).json({ error: 'Failed to fetch analytics' })
  }
}
