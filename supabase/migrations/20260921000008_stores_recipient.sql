-- stores 新增收件人欄位：供「套用店家最新地址」時帶入收件人姓名
alter table public.stores add column recipient text;