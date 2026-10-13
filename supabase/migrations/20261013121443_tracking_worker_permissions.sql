-- Remove inherited client privileges from internal worker RPCs only.
revoke execute on function public.tracking_ingest(uuid,jsonb,text,boolean),public.tracking_process_receipt(uuid),public.tracking_claim_jobs(integer),public.tracking_fail_job(uuid,text),public.tracking_prune() from authenticated;
