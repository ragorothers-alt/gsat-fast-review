-- 失手過（答錯、看解答、標成猜的或不太確定）：只會從 0 變 1，合併時取較大值。
-- 次數各取較大值會蓋掉「某一台看過解答」的痕跡，所以另外記；舊資料從次數與盒子推回來
ALTER TABLE cards ADD COLUMN missed INTEGER NOT NULL DEFAULT 0;
UPDATE cards SET missed = 1 WHERE wrongs > 0 OR rights < seen OR parked = 1 OR box < 2;

-- 推播連續送不出去的天數：太多天就刪掉這筆訂閱
ALTER TABLE push_subs ADD COLUMN fails INTEGER NOT NULL DEFAULT 0;
