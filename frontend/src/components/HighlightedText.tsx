import { Text } from "react-native";
import { highlightMatches } from "@/src/lib/fuzzy";

export function HighlightedText({
  text,
  query,
  style,
  hlColor,
  numberOfLines,
}: {
  text: string;
  query: string;
  style?: React.ComponentProps<typeof Text>["style"];
  hlColor: string;
  numberOfLines?: number;
}) {
  const spans = highlightMatches(query, text);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {spans.map((s, i) =>
        s.matched ? (
          <Text key={i} style={{ color: hlColor, fontWeight: "700" }}>
            {s.text}
          </Text>
        ) : (
          <Text key={i}>{s.text}</Text>
        ),
      )}
    </Text>
  );
}
