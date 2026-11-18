import { useCallback, useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { listItems, subscribeTables, type ItemCursor, type ItemRow as Item } from '@dukaan/db';
import { radius, space, type as typeScale } from '@/constants/theme';
import { useT } from '@/i18n';
import { getDb } from '@/lib/db';
import { useItemSearch } from '@/lib/hooks';
import { ItemRow } from '@/ui/ItemRow';
import { Screen, Text } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

const PAGE = 60;

/** Paged catalogue (keyset pagination) when idle; FTS search results while typing. */
function useCataloguePages() {
  const [rows, setRows] = useState<Item[]>([]);
  const cursor = useRef<ItemCursor>(null);
  const done = useRef(false);
  const loading = useRef(false);

  const loadMore = useCallback(async () => {
    if (loading.current || done.current) return;
    loading.current = true;
    const page = await listItems(await getDb(), { after: cursor.current, limit: PAGE });
    cursor.current = page.next;
    done.current = page.next === null;
    setRows((r) => [...r, ...page.rows]);
    loading.current = false;
  }, []);

  const reset = useCallback(() => {
    cursor.current = null;
    done.current = false;
    setRows([]);
    void loadMore();
  }, [loadMore]);

  useEffect(() => {
    void loadMore();
    return subscribeTables(['item', 'stock'], reset);
  }, [loadMore, reset]);

  return { rows, loadMore };
}

export default function CatalogueScreen() {
  const t = useT();
  const c = useColors();
  const [query, setQuery] = useState('');
  const search = useItemSearch(query);
  const pages = useCataloguePages();
  const data = query.trim() ? search.hits : pages.rows;

  return (
    <Screen padded={false}>
      <View style={{ padding: space.lg, gap: space.sm }}>
        <Text variant="title">{t('tab.catalogue')}</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('common.search')}
          placeholderTextColor={c.ink3}
          autoCorrect={false}
          autoCapitalize="none"
          testID="catalogue-search"
          style={[typeScale.body, { backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 48, color: c.ink }]}
        />
        {query.trim() && search.ms !== null ? (
          <Text variant="caption" tone="ink3" testID="search-timing">{search.hits.length} results · {search.ms.toFixed(1)} ms</Text>
        ) : null}
      </View>
      <FlashList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ItemRow item={item} />}
        onEndReached={query.trim() ? undefined : pages.loadMore}
        onEndReachedThreshold={0.5}
        keyboardShouldPersistTaps="handled"
        testID="catalogue-list"
      />
    </Screen>
  );
}
