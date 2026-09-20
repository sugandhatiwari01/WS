import { PropsWithChildren } from "react";
import { Pressable, Text, View } from "react-native";
import { colors, styles } from "@/lib/theme";
export function Header({ title, subtitle }: { title: string; subtitle?: string }) { return <View style={{ marginBottom: 20 }}><Text style={styles.title}>{title}</Text>{subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}</View>; }
export function Action({ label, onPress, secondary = false }: { label: string; onPress: () => void; secondary?: boolean }) { return <Pressable onPress={onPress} style={[styles.button, secondary && { backgroundColor: "#FCE8EF" }]}><Text style={[styles.buttonText, secondary && { color: colors.primary }]}>{label}</Text></Pressable>; }
export function Card({ children }: PropsWithChildren) { return <View style={styles.card}>{children}</View>; }
